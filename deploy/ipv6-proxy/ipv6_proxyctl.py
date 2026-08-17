#!/usr/bin/env python3
import argparse
import ipaddress
import json
import os
import pathlib
import secrets
import subprocess
import sys
import tempfile
import time


DEFAULT_STATE = pathlib.Path("/etc/ipv6-proxy-manager/proxies.json")
DEFAULT_CREDENTIALS = pathlib.Path("/etc/ipv6-proxy-manager/credentials.env")
DEFAULT_CONFIG = pathlib.Path("/etc/ipv6-proxy-manager/sing-box.json")
DEFAULT_PREFIX = "2a0a:4cc0:101:319::/64"
DEFAULT_INTERFACE = "eth0"
DEFAULT_PUBLIC_BASE = 21001
DEFAULT_PRIVATE_BASE = 12001


def new_state(
    prefix=DEFAULT_PREFIX,
    interface=DEFAULT_INTERFACE,
    public_base=DEFAULT_PUBLIC_BASE,
    private_base=DEFAULT_PRIVATE_BASE,
    reserved_ipv6=None,
):
    network = ipaddress.IPv6Network(prefix, strict=True)
    return {
        "version": 1,
        "prefix": str(network),
        "interface": interface,
        "public_base": int(public_base),
        "private_base": int(private_base),
        "next_id": 1,
        "reserved_ipv6": [str(ipaddress.IPv6Address(value)) for value in (reserved_ipv6 or [])],
        "entries": [],
    }


def _random_hosts():
    while True:
        yield secrets.randbits(64)


def add_entries(state, count, candidate_hosts=None):
    if count < 1:
        raise ValueError("count must be positive")
    validate_state(state)
    network = ipaddress.IPv6Network(state["prefix"], strict=True)
    hosts = candidate_hosts if candidate_hosts is not None else _random_hosts()
    used = {ipaddress.IPv6Address(value) for value in state.get("reserved_ipv6", [])}
    used.update(ipaddress.IPv6Address(entry["ipv6"]) for entry in state["entries"])

    for _ in range(count):
        entry_id = int(state["next_id"])
        public_port = int(state["public_base"]) + entry_id - 1
        private_port = int(state["private_base"]) + entry_id - 1
        if public_port > 65535 or private_port > 65535:
            raise ValueError("port range exhausted")

        while True:
            host = int(next(hosts))
            if host <= 0 or host >= network.num_addresses:
                continue
            address = network.network_address + host
            if address not in used:
                break
        used.add(address)
        state["entries"].append(
            {
                "id": entry_id,
                "ipv6": str(address),
                "public_port": public_port,
                "private_port": private_port,
                "enabled": True,
            }
        )
        state["next_id"] = entry_id + 1

    validate_state(state)
    return state


def disable_entry(state, entry_id):
    for entry in state["entries"]:
        if int(entry["id"]) == int(entry_id):
            if not entry["enabled"]:
                raise ValueError(f"entry {entry_id} is already disabled")
            entry["enabled"] = False
            validate_state(state)
            return entry
    raise ValueError(f"unknown entry {entry_id}")


def validate_state(state):
    if state.get("version") != 1:
        raise ValueError("unsupported state version")
    network = ipaddress.IPv6Network(state["prefix"], strict=True)
    if not state.get("interface"):
        raise ValueError("interface is required")
    entries = state.get("entries")
    if not isinstance(entries, list):
        raise ValueError("entries must be a list")

    ids = set()
    addresses = set()
    public_ports = set()
    private_ports = set()
    for entry in entries:
        entry_id = int(entry["id"])
        address = ipaddress.IPv6Address(entry["ipv6"])
        public_port = int(entry["public_port"])
        private_port = int(entry["private_port"])
        if entry_id in ids:
            raise ValueError(f"duplicate entry ID {entry_id}")
        if address in addresses:
            raise ValueError(f"duplicate IPv6 address {address}")
        if public_port in public_ports:
            raise ValueError(f"duplicate public port {public_port}")
        if private_port in private_ports:
            raise ValueError(f"duplicate private port {private_port}")
        if address not in network:
            raise ValueError(f"IPv6 address outside prefix: {address}")
        if public_port < 1 or public_port > 65535 or private_port < 1 or private_port > 65535:
            raise ValueError("port outside valid range")
        ids.add(entry_id)
        addresses.add(address)
        public_ports.add(public_port)
        private_ports.add(private_port)

    next_id = int(state.get("next_id", 0))
    if next_id < 1 or (ids and next_id <= max(ids)):
        raise ValueError("next_id must be greater than every existing ID")
    return state


def render_sing_box(state, username, password):
    validate_state(state)
    if not username or not password:
        raise ValueError("public username and password are required")

    inbounds = []
    outbounds = []
    rules = []
    for entry in state["entries"]:
        if not entry["enabled"]:
            continue
        suffix = f'{int(entry["id"]):04d}'
        public_tag = f"public-{suffix}"
        private_tag = f"private-{suffix}"
        outbound_tag = f"egress-{suffix}"
        inbounds.extend(
            [
                {
                    "type": "socks",
                    "tag": public_tag,
                    "listen": "0.0.0.0",
                    "listen_port": int(entry["public_port"]),
                    "users": [{"username": username, "password": password}],
                },
                {
                    "type": "socks",
                    "tag": private_tag,
                    "listen": "127.0.0.1",
                    "listen_port": int(entry["private_port"]),
                    "users": [],
                },
            ]
        )
        outbounds.append(
            {
                "type": "direct",
                "tag": outbound_tag,
                "inet6_bind_address": entry["ipv6"],
                "domain_resolver": {"server": "local", "strategy": "ipv6_only"},
            }
        )
        rules.extend(
            [
                {"inbound": public_tag, "action": "route", "outbound": outbound_tag},
                {"inbound": private_tag, "action": "route", "outbound": outbound_tag},
            ]
        )

    return {
        "log": {"level": "warn", "timestamp": True},
        "dns": {"servers": [{"type": "local", "tag": "local"}]},
        "inbounds": inbounds,
        "outbounds": outbounds,
        "route": {"rules": rules},
    }


def address_plan(state, current_addresses):
    validate_state(state)
    current = {str(ipaddress.IPv6Address(value)) for value in current_addresses}
    enabled = {entry["ipv6"] for entry in state["entries"] if entry["enabled"]}
    disabled = {entry["ipv6"] for entry in state["entries"] if not entry["enabled"]}
    return sorted(enabled - current), sorted(disabled & current)


def firewall_port_chunks(state, chunk_size=15):
    if chunk_size < 1 or chunk_size > 15:
        raise ValueError("iptables multiport chunk size must be between 1 and 15")
    validate_state(state)
    ports = sorted(int(entry["public_port"]) for entry in state["entries"] if entry["enabled"])
    return [ports[index:index + chunk_size] for index in range(0, len(ports), chunk_size)]


def verify_observations(state, observations):
    validate_state(state)
    enabled = [entry for entry in state["entries"] if entry["enabled"]]
    if set(observations) != {int(entry["id"]) for entry in enabled}:
        raise ValueError("observations do not cover every enabled entry")
    normalized = {}
    for entry in enabled:
        entry_id = int(entry["id"])
        expected = str(ipaddress.IPv6Address(entry["ipv6"]))
        observed = str(ipaddress.IPv6Address(observations[entry_id]))
        if observed != expected:
            raise ValueError(f"entry {entry_id} expected {expected}, observed {observed}")
        normalized[entry_id] = observed
    if len(set(normalized.values())) != len(normalized):
        raise ValueError("observed IPv6 addresses are not unique")
    return normalized


def run_command(command, check=True, capture_output=True):
    return subprocess.run(command, check=check, text=True, capture_output=capture_output)


def current_global_ipv6(interface):
    result = run_command(["ip", "-j", "-6", "addr", "show", "dev", interface])
    payload = json.loads(result.stdout)
    addresses = set()
    for link in payload:
        for info in link.get("addr_info", []):
            if info.get("family") == "inet6" and info.get("scope") == "global":
                addresses.add(str(ipaddress.IPv6Address(info["local"])))
    return addresses


def sync_addresses(state):
    current = current_global_ipv6(state["interface"])
    add, remove = address_plan(state, current)
    network = ipaddress.IPv6Network(state["prefix"], strict=True)
    prefix_length = network.prefixlen
    for address in add:
        run_command(
            [
                "ip", "-6", "addr", "add", f"{address}/{prefix_length}",
                "dev", state["interface"], "preferred_lft", "0",
            ]
        )
    for address in remove:
        run_command(["ip", "-6", "addr", "del", f"{address}/{prefix_length}", "dev", state["interface"]])
    wait_for_dad(state)
    for entry in state["entries"]:
        if entry["enabled"]:
            run_command(
                [
                    "ip", "-6", "addr", "change", f'{entry["ipv6"]}/{prefix_length}',
                    "dev", state["interface"], "preferred_lft", "0",
                ]
            )
    return add, remove


def wait_for_dad(state, timeout=30):
    expected = {entry["ipv6"] for entry in state["entries"] if entry["enabled"]}
    deadline = time.monotonic() + timeout
    while True:
        result = run_command(["ip", "-6", "addr", "show", "dev", state["interface"]])
        output = result.stdout
        if "dadfailed" in output:
            raise RuntimeError("IPv6 duplicate address detection failed")
        current = current_global_ipv6(state["interface"])
        if expected <= current and "tentative" not in output:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError("timed out waiting for IPv6 duplicate address detection")
        time.sleep(0.5)


def _iptables_chain_exists(chain):
    return run_command(["iptables", "-w", "-n", "-L", chain], check=False).returncode == 0


def _iptables_rule_exists(chain, arguments):
    return run_command(["iptables", "-w", "-C", chain, *arguments], check=False).returncode == 0


def reconcile_firewall(state):
    chain = "IPV6_PROXY"
    parent = "1PANEL_BASIC_BEFORE" if _iptables_chain_exists("1PANEL_BASIC_BEFORE") else "INPUT"
    if not _iptables_chain_exists(chain):
        run_command(["iptables", "-w", "-N", chain])
    if not _iptables_rule_exists(parent, ["-j", chain]):
        run_command(["iptables", "-w", "-I", parent, "1", "-j", chain])
    run_command(["iptables", "-w", "-F", chain])
    for ports in firewall_port_chunks(state):
        run_command(
            [
                "iptables", "-w", "-A", chain,
                "-p", "tcp", "-m", "multiport",
                "--dports", ",".join(str(port) for port in ports),
                "-j", "ACCEPT",
            ]
        )
    run_command(["iptables", "-w", "-A", chain, "-j", "RETURN"])


def validate_sing_box_config(config_path):
    run_command(["/usr/local/bin/sing-box", "check", "-c", str(config_path)])


def prepare_runtime(state_path, credential_path, config_path):
    state = load_state(state_path)
    render_to_path(state_path, credential_path, config_path)
    validate_sing_box_config(config_path)
    sync_addresses(state)
    reconcile_firewall(state)
    return state


def parse_cloudflare_trace(payload):
    for line in payload.splitlines():
        key, separator, value = line.partition("=")
        if separator and key == "ip" and value:
            return str(ipaddress.ip_address(value))
    raise ValueError("Cloudflare trace response is missing ip field")


def observe_local_egress(state, repeat=1):
    observations = {}
    for entry in state["entries"]:
        if not entry["enabled"]:
            continue
        observed_for_entry = []
        for _ in range(repeat):
            result = run_command(
                [
                    "curl", "-fsS", "--connect-timeout", "8", "--max-time", "20",
                    "--retry", "2", "--retry-all-errors", "--retry-delay", "1",
                    "--socks5-hostname", f'127.0.0.1:{entry["private_port"]}',
                    "https://www.cloudflare.com/cdn-cgi/trace",
                ]
            )
            observed_for_entry.append(parse_cloudflare_trace(result.stdout))
        if len(set(observed_for_entry)) != 1:
            raise ValueError(f'entry {entry["id"]} egress changed between requests')
        observations[int(entry["id"])] = observed_for_entry[0]
    return observations


def verify_runtime(state_path, repeat=1):
    state = load_state(state_path)
    observations = observe_local_egress(state, repeat=repeat)
    return verify_observations(state, observations)


def atomic_write_text(path, content, mode=0o600):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, mode)
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def atomic_write_json(path, data, mode=0o600):
    atomic_write_text(path, json.dumps(data, indent=2, sort_keys=True) + "\n", mode=mode)


def load_state(path):
    with pathlib.Path(path).open(encoding="utf-8") as handle:
        state = json.load(handle)
    return validate_state(state)


def write_credentials(path, username, password):
    if not username or not password or "\n" in username or "\n" in password:
        raise ValueError("invalid credentials")
    atomic_write_text(path, f"PROXY_USERNAME={username}\nPROXY_PASSWORD={password}\n", mode=0o600)


def read_credentials(path):
    values = {}
    with pathlib.Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            key, separator, value = line.partition("=")
            if not separator:
                raise ValueError("invalid credential file")
            values[key] = value
    try:
        return values["PROXY_USERNAME"], values["PROXY_PASSWORD"]
    except KeyError as error:
        raise ValueError("credential file is incomplete") from error


def generate_credentials():
    return f"proxy_{secrets.token_hex(6)}", secrets.token_urlsafe(24)


def render_to_path(state_path, credential_path, config_path):
    state = load_state(state_path)
    username, password = read_credentials(credential_path)
    config = render_sing_box(state, username, password)
    atomic_write_json(config_path, config, mode=0o640)
    return config


def build_parser():
    parser = argparse.ArgumentParser(description="Manage stable IPv6 SOCKS proxy mappings")
    parser.add_argument("--state", type=pathlib.Path, default=DEFAULT_STATE)
    parser.add_argument("--credentials", type=pathlib.Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument("--config", type=pathlib.Path, default=DEFAULT_CONFIG)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init")
    init_parser.add_argument("--count", type=int, default=100)
    init_parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    init_parser.add_argument("--interface", default=DEFAULT_INTERFACE)
    init_parser.add_argument("--public-base", type=int, default=DEFAULT_PUBLIC_BASE)
    init_parser.add_argument("--private-base", type=int, default=DEFAULT_PRIVATE_BASE)
    init_parser.add_argument("--reserve-ip", action="append", default=[])

    add_parser = subparsers.add_parser("add")
    add_parser.add_argument("count", type=int)
    remove_parser = subparsers.add_parser("remove")
    remove_parser.add_argument("entry_id", type=int)
    subparsers.add_parser("list")
    subparsers.add_parser("render")
    subparsers.add_parser("prepare")
    subparsers.add_parser("apply")
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--repeat", type=int, default=1)
    subparsers.add_parser("rotate-credentials")
    subparsers.add_parser("show-credentials")
    return parser


def _write_state_and_config(args, state):
    validate_state(state)
    atomic_write_json(args.state, state, mode=0o600)
    render_to_path(args.state, args.credentials, args.config)


def main(argv=None, stdout=None):
    stdout = stdout or sys.stdout
    args = build_parser().parse_args(argv)

    if args.command == "init":
        if args.state.exists() or args.credentials.exists():
            raise ValueError("refusing to overwrite existing state or credentials")
        state = new_state(
            args.prefix,
            args.interface,
            args.public_base,
            args.private_base,
            reserved_ipv6=args.reserve_ip,
        )
        add_entries(state, args.count)
        username, password = generate_credentials()
        write_credentials(args.credentials, username, password)
        _write_state_and_config(args, state)
        print(f"initialized {args.count} entries", file=stdout)
        return 0

    if args.command == "list":
        state = load_state(args.state)
        print("id status ipv6 public_port private_port", file=stdout)
        for entry in state["entries"]:
            status = "enabled" if entry["enabled"] else "disabled"
            print(
                f'{entry["id"]} {status} {entry["ipv6"]} {entry["public_port"]} {entry["private_port"]}',
                file=stdout,
            )
        return 0

    if args.command == "show-credentials":
        username, password = read_credentials(args.credentials)
        print(f"PROXY_USERNAME={username}", file=stdout)
        print(f"PROXY_PASSWORD={password}", file=stdout)
        return 0

    if args.command == "rotate-credentials":
        username, password = generate_credentials()
        write_credentials(args.credentials, username, password)
        render_to_path(args.state, args.credentials, args.config)
        print("credentials rotated", file=stdout)
        return 0

    if args.command == "prepare":
        state = prepare_runtime(args.state, args.credentials, args.config)
        print(f'prepared {sum(1 for entry in state["entries"] if entry["enabled"])} entries', file=stdout)
        return 0

    if args.command == "apply":
        state = prepare_runtime(args.state, args.credentials, args.config)
        run_command(["systemctl", "restart", "ipv6-proxy.service"])
        run_command(["systemctl", "is-active", "--quiet", "ipv6-proxy.service"])
        print(f'applied {sum(1 for entry in state["entries"] if entry["enabled"])} entries', file=stdout)
        return 0

    if args.command == "verify":
        observations = verify_runtime(args.state, repeat=args.repeat)
        print(f"verified {len(observations)} unique fixed IPv6 egress mappings", file=stdout)
        return 0

    state = load_state(args.state)
    if args.command == "add":
        add_entries(state, args.count)
        _write_state_and_config(args, state)
        print(f"added {args.count} entries", file=stdout)
        return 0
    if args.command == "remove":
        disable_entry(state, args.entry_id)
        _write_state_and_config(args, state)
        print(f"disabled entry {args.entry_id}", file=stdout)
        return 0
    if args.command == "render":
        render_to_path(args.state, args.credentials, args.config)
        print(f"rendered {args.config}", file=stdout)
        return 0
    raise ValueError(f"unsupported command {args.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
