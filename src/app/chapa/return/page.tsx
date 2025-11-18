"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import Image from "next/image";

type StatusTone = "info" | "success" | "alert";

const formatETB = (value: number) =>
  new Intl.NumberFormat("en-ET", {
    style: "currency",
    currency: "ETB",
    maximumFractionDigits: 2,
  }).format(value);

function ChapaReturnContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<{ tone: StatusTone; message: string }>({
    tone: "info",
    message: "Verifying payment with Chapa…",
  });

  useEffect(() => {
    const txRef = searchParams.get("tx_ref");
    if (!txRef) {
      setStatus({
        tone: "alert",
        message: "Missing transaction reference. Redirecting…",
      });
      setTimeout(() => router.push("/"), 3000);
      return;
    }

    const verifyPayment = async () => {
      try {
        const response = await fetch(`/api/chapa/verify?tx_ref=${txRef}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Payment verification failed.");
        }

        if (payload.status === "success") {
          if (typeof window !== "undefined") {
            localStorage.setItem(
              "chapa_payment_result",
              JSON.stringify({
                txRef,
                userAmount: payload.userAmount ?? 50,
                status: "success",
                timestamp: Date.now(),
              }),
            );
          }
          setStatus({
            tone: "success",
            message: `Payment confirmed! Redirecting to update your card…`,
          });
          setTimeout(() => router.push("/"), 2000);
        } else {
          setStatus({
            tone: "alert",
            message: "Payment was not completed. Redirecting…",
          });
          setTimeout(() => router.push("/"), 3000);
        }
      } catch (error) {
        console.error(error);
        setStatus({
          tone: "alert",
          message:
            error instanceof Error
              ? error.message
              : "Unable to verify payment. Redirecting…",
        });
        setTimeout(() => router.push("/"), 3000);
      }
    };

    verifyPayment();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen bg-[#FDF9F0] px-4 py-10">
      <main className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header className="rounded-3xl border border-[#F5AD00]/30 bg-white p-5 shadow-[0_20px_60px_rgba(44,46,123,0.08)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-[#ED8800]">
                ELPA pilot
              </p>
              <h1 className="text-2xl font-semibold text-[#2C2E7B]">
                Payment verification
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <Image
                src="/gebeta-logo.svg"
                alt="Gebeta logo"
                width={120}
                height={32}
                priority
              />
              <span className="h-8 w-px bg-[#E5E7EB]" aria-hidden />
              <Image
                src="/ethiopost-logo.svg"
                alt="Ethiopost logo"
                width={140}
                height={32}
                priority
              />
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-[#2C2E7B]/10 bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.05)]">
          <div
            className={`rounded-2xl px-4 py-3 text-sm ${
              status.tone === "success"
                ? "bg-[#E4F4F9] text-[#00516E]"
                : status.tone === "alert"
                  ? "bg-[#FDE2D9] text-[#9E2F1B]"
                  : "bg-[#FFEFD1] text-[#7C4A00]"
            }`}
          >
            {status.message}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function ChapaReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FDF9F0] px-4 py-10 flex items-center justify-center">
          <div className="text-center">
            <p className="text-[#2C2E7B]">Loading payment verification…</p>
          </div>
        </div>
      }
    >
      <ChapaReturnContent />
    </Suspense>
  );
}

