import importlib.util
import io
import json
import os
import pathlib
import stat
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "ipv6_proxyctl.py"
SPEC = importlib.util.spec_from_file_location("ipv6_proxyctl", MODULE_PATH)
proxyctl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proxyctl)


class StateTests(unittest.TestCase):
    def base_state(self):
        return proxyctl.new_state(
            prefix="2a0a:4cc0:101:319::/64",
            interface="eth0",
            public_base=21001,
            private_base=12001,
            reserved_ipv6=["2a0a:4cc0:101:319::1"],
        )

    def test_add_entries_generates_unique_stable_mapping(self):
        state = self.base_state()
        proxyctl.add_entries(state, 3, candidate_hosts=iter([1, 0x101, 0x102, 0x103]))

        self.assertEqual([entry["id"] for entry in state["entries"]], [1, 2, 3])
        self.assertEqual(
            [entry["ipv6"] for entry in state["entries"]],
            [
                "2a0a:4cc0:101:319::101",
                "2a0a:4cc0:101:319::102",
                "2a0a:4cc0:101:319::103",
            ],
        )
        self.assertEqual([entry["public_port"] for entry in state["entries"]], [21001, 21002, 21003])
        self.assertEqual([entry["private_port"] for entry in state["entries"]], [12001, 12002, 12003])
        self.assertTrue(all(entry["enabled"] for entry in state["entries"]))

        original = json.loads(json.dumps(state))
        proxyctl.validate_state(state)
        self.assertEqual(state, original)

    def test_add_entries_preserves_existing_entries_and_never_reuses_ids(self):
        state = self.base_state()
        proxyctl.add_entries(state, 2, candidate_hosts=iter([0x101, 0x102]))
        proxyctl.disable_entry(state, 1)
        proxyctl.add_entries(state, 1, candidate_hosts=iter([0x103]))

        self.assertEqual([entry["id"] for entry in state["entries"]], [1, 2, 3])
        self.assertEqual(state["entries"][0]["ipv6"], "2a0a:4cc0:101:319::101")
        self.assertFalse(state["entries"][0]["enabled"])
        self.assertEqual(state["entries"][2]["public_port"], 21003)

    def test_validate_state_rejects_duplicate_ipv6_and_ports(self):
        state = self.base_state()
        proxyctl.add_entries(state, 2, candidate_hosts=iter([0x101, 0x102]))
        state["entries"][1]["ipv6"] = state["entries"][0]["ipv6"]
        with self.assertRaisesRegex(ValueError, "duplicate IPv6"):
            proxyctl.validate_state(state)

        state["entries"][1]["ipv6"] = "2a0a:4cc0:101:319::102"
        state["entries"][1]["public_port"] = state["entries"][0]["public_port"]
        with self.assertRaisesRegex(ValueError, "duplicate public port"):
            proxyctl.validate_state(state)

    def test_disable_unknown_entry_fails(self):
        state = self.base_state()
        with self.assertRaisesRegex(ValueError, "unknown entry"):
            proxyctl.disable_entry(state, 99)


class RenderTests(unittest.TestCase):
    def test_render_creates_one_source_bound_outbound_per_listener_pair(self):
        state = proxyctl.new_state("2a0a:4cc0:101:319::/64", "eth0", 21001, 12001)
        proxyctl.add_entries(state, 2, candidate_hosts=iter([0x101, 0x102]))

        config = proxyctl.render_sing_box(state, "public-user", "public-password")

        self.assertEqual(len(config["inbounds"]), 4)
        self.assertEqual(len(config["outbounds"]), 2)
        self.assertEqual(len(config["route"]["rules"]), 4)
        for entry in state["entries"]:
            suffix = f'{entry["id"]:04d}'
            public = next(item for item in config["inbounds"] if item["tag"] == f"public-{suffix}")
            private = next(item for item in config["inbounds"] if item["tag"] == f"private-{suffix}")
            outbound = next(item for item in config["outbounds"] if item["tag"] == f"egress-{suffix}")
            rules = [rule for rule in config["route"]["rules"] if rule["inbound"] in [public["tag"], private["tag"]]]

            self.assertEqual(public["listen"], "0.0.0.0")
            self.assertEqual(public["listen_port"], entry["public_port"])
            self.assertEqual(public["users"], [{"username": "public-user", "password": "public-password"}])
            self.assertEqual(private["listen"], "127.0.0.1")
            self.assertEqual(private["listen_port"], entry["private_port"])
            self.assertEqual(private["users"], [])
            self.assertEqual(outbound["inet6_bind_address"], entry["ipv6"])
            self.assertEqual(outbound["domain_strategy"], "ipv6_only")
            self.assertEqual({rule["outbound"] for rule in rules}, {outbound["tag"]})

    def test_render_ignores_disabled_entries(self):
        state = proxyctl.new_state("2a0a:4cc0:101:319::/64", "eth0", 21001, 12001)
        proxyctl.add_entries(state, 2, candidate_hosts=iter([0x101, 0x102]))
        proxyctl.disable_entry(state, 1)

        config = proxyctl.render_sing_box(state, "user", "password")

        rendered = json.dumps(config)
        self.assertNotIn("public-0001", rendered)
        self.assertIn("public-0002", rendered)


class FileAndCredentialTests(unittest.TestCase):
    def test_atomic_json_write_uses_requested_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "state.json"
            proxyctl.atomic_write_json(path, {"ok": True}, mode=0o600)
            self.assertEqual(json.loads(path.read_text()), {"ok": True})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_credentials_round_trip_without_implicit_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "credentials.env"
            proxyctl.write_credentials(path, "proxy-user", "secret-value")
            self.assertEqual(proxyctl.read_credentials(path), ("proxy-user", "secret-value"))
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_rotate_credentials_changes_secret_without_printing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            state_path = tmp_path / "proxies.json"
            credential_path = tmp_path / "credentials.env"
            config_path = tmp_path / "sing-box.json"
            proxyctl.main(
                [
                    "--state", str(state_path),
                    "--credentials", str(credential_path),
                    "--config", str(config_path),
                    "init", "--count", "1",
                ],
                stdout=io.StringIO(),
            )
            before = proxyctl.read_credentials(credential_path)
            output = io.StringIO()
            proxyctl.main(
                [
                    "--state", str(state_path),
                    "--credentials", str(credential_path),
                    "--config", str(config_path),
                    "rotate-credentials",
                ],
                stdout=output,
            )
            after = proxyctl.read_credentials(credential_path)

            self.assertNotEqual(before, after)
            self.assertNotIn(after[0], output.getvalue())
            self.assertNotIn(after[1], output.getvalue())


class RuntimePlanningTests(unittest.TestCase):
    def state_with_disabled_entry(self):
        state = proxyctl.new_state(
            "2a0a:4cc0:101:319::/64",
            "eth0",
            21001,
            12001,
            reserved_ipv6=["2a0a:4cc0:101:319::1"],
        )
        proxyctl.add_entries(state, 3, candidate_hosts=iter([0x101, 0x102, 0x103]))
        proxyctl.disable_entry(state, 2)
        return state

    def test_address_plan_adds_enabled_and_removes_only_disabled_managed_addresses(self):
        state = self.state_with_disabled_entry()
        current = {
            "2a0a:4cc0:101:319::1",
            "2a0a:4cc0:101:319::102",
            "2a0a:4cc0:101:319::ffff",
        }

        add, remove = proxyctl.address_plan(state, current)

        self.assertEqual(add, ["2a0a:4cc0:101:319::101", "2a0a:4cc0:101:319::103"])
        self.assertEqual(remove, ["2a0a:4cc0:101:319::102"])

    def test_firewall_chunks_include_enabled_public_ports_only(self):
        state = proxyctl.new_state("2a0a:4cc0:101:319::/64", "eth0", 21001, 12001)
        proxyctl.add_entries(state, 17, candidate_hosts=iter(range(0x101, 0x112)))
        proxyctl.disable_entry(state, 2)

        chunks = proxyctl.firewall_port_chunks(state, chunk_size=15)

        flattened = [port for chunk in chunks for port in chunk]
        self.assertEqual(len(chunks), 2)
        self.assertNotIn(21002, flattened)
        self.assertEqual(flattened, [21001] + list(range(21003, 21018)))

    def test_verify_observations_requires_exact_unique_mapping(self):
        state = proxyctl.new_state("2a0a:4cc0:101:319::/64", "eth0", 21001, 12001)
        proxyctl.add_entries(state, 2, candidate_hosts=iter([0x101, 0x102]))
        observations = {1: "2a0a:4cc0:101:319::101", 2: "2a0a:4cc0:101:319::102"}

        proxyctl.verify_observations(state, observations)

        observations[2] = observations[1]
        with self.assertRaisesRegex(ValueError, "entry 2 expected"):
            proxyctl.verify_observations(state, observations)


class DeploymentAssetTests(unittest.TestCase):
    def test_installer_pins_and_verifies_sing_box_release(self):
        installer = (ROOT / "install.sh").read_text()
        self.assertIn("SING_BOX_VERSION=1.13.19", installer)
        self.assertIn("ef88a9e577d474210867bd708933d042e9b70106529df2656182c9db90106aa1", installer)
        self.assertIn("sha256sum -c", installer)
        self.assertIn("ipv6-proxyctl init --count", installer)

    def test_units_order_address_preparation_before_proxy(self):
        prepare = (ROOT / "systemd" / "ipv6-proxy-prepare.service").read_text()
        proxy = (ROOT / "systemd" / "ipv6-proxy.service").read_text()

        self.assertIn("Type=oneshot", prepare)
        self.assertIn("ipv6-proxyctl prepare", prepare)
        self.assertIn("Requires=ipv6-proxy-prepare.service", proxy)
        self.assertIn("After=ipv6-proxy-prepare.service", proxy)
        self.assertIn("sing-box check", proxy)
        self.assertIn("Restart=on-failure", proxy)
        self.assertIn("NoNewPrivileges=true", proxy)


class CLITests(unittest.TestCase):
    def test_init_list_add_remove_and_render(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = pathlib.Path(tmp)
            state_path = tmp_path / "proxies.json"
            credential_path = tmp_path / "credentials.env"
            config_path = tmp_path / "sing-box.json"
            output = io.StringIO()

            rc = proxyctl.main(
                [
                    "--state", str(state_path),
                    "--credentials", str(credential_path),
                    "--config", str(config_path),
                    "init", "--count", "2",
                ],
                stdout=output,
            )
            self.assertEqual(rc, 0)
            self.assertNotIn("PROXY_PASSWORD", output.getvalue())
            self.assertEqual(len(json.loads(state_path.read_text())["entries"]), 2)

            self.assertEqual(proxyctl.main(["--state", str(state_path), "list"], stdout=io.StringIO()), 0)
            self.assertEqual(
                proxyctl.main(
                    ["--state", str(state_path), "--credentials", str(credential_path), "--config", str(config_path), "add", "1"],
                    stdout=io.StringIO(),
                ),
                0,
            )
            self.assertEqual(
                proxyctl.main(
                    ["--state", str(state_path), "--credentials", str(credential_path), "--config", str(config_path), "remove", "2"],
                    stdout=io.StringIO(),
                ),
                0,
            )
            state = json.loads(state_path.read_text())
            self.assertEqual([entry["enabled"] for entry in state["entries"]], [True, False, True])
            config = json.loads(config_path.read_text())
            self.assertEqual(len(config["outbounds"]), 2)


if __name__ == "__main__":
    unittest.main()
