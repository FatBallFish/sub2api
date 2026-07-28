import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Link, useSearchParams } from "react-router-dom";
import { getPaymentCheckoutInfo } from "../../api/payment";

type StripePaymentContext = {
  clientSecret: string;
  resumeToken?: string;
  outTradeNo?: string;
};

function StripePaymentForm({ orderId, context }: { orderId: string; context: StripePaymentContext }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    const returnURL = new URL("/payment/result", window.location.origin);
    if (context.resumeToken) returnURL.searchParams.set("resume_token", context.resumeToken);
    else if (context.outTradeNo) returnURL.searchParams.set("out_trade_no", context.outTradeNo);
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnURL.toString() } });
    if (result.error) {
      setError(result.error.message || "Payment could not be confirmed.");
      setSubmitting(false);
      return;
    }
    sessionStorage.removeItem(`stripe-payment:${orderId}`);
  }

  return (
    <form onSubmit={submit} className="w-full max-w-xl bg-white p-6 sm:p-8">
      <div className="mb-6 border-b border-zinc-200 pb-5">
        <p className="text-xs font-semibold uppercase text-zinc-500">Secure payment</p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950">Complete your order</h1>
      </div>
      <PaymentElement />
      {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
      <button type="submit" disabled={!stripe || submitting} className="mt-6 h-11 w-full bg-zinc-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-400">
        {submitting ? "Confirming..." : "Pay now"}
      </button>
    </form>
  );
}

export default function StripePayment() {
  const [params] = useSearchParams();
  const orderId = params.get("order_id")?.trim() || "";
  const [publishableKey, setPublishableKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const context = useMemo(() => {
    if (!orderId) return null;
    try {
      return JSON.parse(sessionStorage.getItem(`stripe-payment:${orderId}`) || "null") as StripePaymentContext | null;
    } catch {
      return null;
    }
  }, [orderId]);

  useEffect(() => {
    getPaymentCheckoutInfo()
      .then((info) => setPublishableKey(info.stripe_publishable_key || ""))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load Stripe."));
  }, []);

  const stripePromise = useMemo(() => publishableKey ? loadStripe(publishableKey) : null, [publishableKey]);
  if (!context?.clientSecret || !orderId) {
    return <StripeRecovery message="The secure payment context is no longer available. Return to billing to resume or create a new order." />;
  }
  if (error) return <StripeRecovery message={error} />;
  if (!stripePromise) return <div className="flex min-h-screen items-center justify-center bg-zinc-100 text-sm text-zinc-500">Loading secure payment...</div>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 py-10">
      <Elements stripe={stripePromise} options={{ clientSecret: context.clientSecret, appearance: { theme: "stripe" } }}>
        <StripePaymentForm orderId={orderId} context={context} />
      </Elements>
    </main>
  );
}

function StripeRecovery({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <section className="max-w-md bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-zinc-950">Payment unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">{message}</p>
        <Link to="/console/subscription-wallet" className="mt-6 inline-flex h-10 items-center bg-zinc-950 px-5 text-sm font-semibold text-white">Return to billing</Link>
      </section>
    </main>
  );
}
