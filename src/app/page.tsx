"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";

type CardSnapshot = {
  balance: number;
  serialNumber: string;
  lastSynced: string;
};

type StatusTone = "info" | "success" | "alert";

type NDEFRecordPayload = {
  recordType: string;
  data?: DataView;
  encoding?: string;
};

type NDEFMessagePayload = {
  records: NDEFRecordPayload[];
};

type NDEFReadingEvent = Event & {
  serialNumber?: string;
  message: NDEFMessagePayload;
};

type NDEFReaderInstance = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  write: (
    data: string | NDEFMessagePayload,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
};

declare global {
  interface Window {
    NDEFReader?: {
      new (): NDEFReaderInstance;
    };
  }
}

const formatETB = (value: number) =>
  new Intl.NumberFormat("en-ET", {
    style: "currency",
    currency: "ETB",
    maximumFractionDigits: 2,
  }).format(value);

const decodeRecord = (record: NDEFRecordPayload) => {
  if (!record.data) return null;
  try {
    const buffer = record.data.buffer.slice(
      record.data.byteOffset,
      record.data.byteOffset + record.data.byteLength,
    );
    const decoder = new TextDecoder(record.encoding ?? "utf-8");
    return decoder.decode(buffer);
  } catch (error) {
    console.error("Unable to decode NFC record", error);
    return null;
  }
};

const extractBalance = (message: NDEFMessagePayload): number | null => {
  for (const record of message.records) {
    const textValue = decodeRecord(record);
    if (!textValue) continue;
    const match = textValue.match(/(-?\d+(?:\.\d+)?)/);
    if (match) {
      const parsed = Number(match[1]);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

export default function Home() {
  const TOP_UP_AMOUNT = 1;

  const [card, setCard] = useState<CardSnapshot | null>(null);
  const [paymentReference, setPaymentReference] = useState<string | null>(null);
  const [needsReset, setNeedsReset] = useState(false);

  const [status, setStatus] = useState<{ tone: StatusTone; message: string }>({
    tone: "info",
    message: "Android Chrome + NFC only. Tap “Read card” to wake the reader.",
  });
  const [nfcSupported, setNfcSupported] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "NDEFReader" in window) {
      setNfcSupported(true);
    }
  }, []);

  const handleReadCard = useCallback(async () => {
    if (!nfcSupported || !window.NDEFReader) {
      setStatus({
        tone: "alert",
        message: "Web NFC is not available in this browser/device.",
      });
      return;
    }
    try {
      setIsReading(true);
      setStatus({
        tone: "info",
        message: "Hold the card near the phone until you feel the vibration.",
      });

      const ndef = new window.NDEFReader();
      ndef.onreading = (event: NDEFReadingEvent) => {
        const balanceFromCard = extractBalance(event.message);
        if (balanceFromCard === null) {
          setNeedsReset(true);
          setStatus({
            tone: "alert",
            message:
              "Card detected but no balance was found. Tap “Reset to 0 ETB” to initialize.",
          });
        } else {
          setNeedsReset(false);
          setCard({
            balance: balanceFromCard,
            serialNumber: event.serialNumber ?? "Unknown card",
            lastSynced: new Date().toISOString(),
          });
          setStatus({
            tone: "success",
            message: "Balance pulled directly from the card.",
          });
        }
        setIsReading(false);
      };

      ndef.onreadingerror = () => {
        setStatus({
          tone: "alert",
          message: "Could not read the card. Hold it steady and try again.",
        });
        setIsReading(false);
      };

      await ndef.scan();
    } catch (error) {
      console.error(error);
      setStatus({
        tone: "alert",
        message:
          error instanceof Error
            ? error.message
            : "NFC scanning was blocked by the browser.",
      });
      setIsReading(false);
    }
  }, [nfcSupported]);

  const writeBalanceToCard = useCallback(
    async (newBalance: number) => {
      if (!nfcSupported || !window.NDEFReader) {
        throw new Error("Web NFC is not available.");
      }
      try {
        setIsWriting(true);
        setStatus({
          tone: "info",
          message: "Hold the card still while we write the new balance…",
        });
        const ndef = new window.NDEFReader();
        await ndef.write(`BAL:${newBalance.toFixed(2)}`);
        setStatus({
          tone: "success",
          message: "Card updated with the new balance.",
        });
        setNeedsReset(false);
      } finally {
        setIsWriting(false);
      }
    },
    [nfcSupported],
  );

  const handleChapaRefill = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!card) {
        setStatus({
          tone: "alert",
          message: "Read the card first so we know the starting balance.",
        });
        return;
      }
      try {
        setIsProcessing(true);
        setPaymentReference(null);
        setStatus({
          tone: "info",
          message: "Opening Chapa checkout for ETB 1…",
        });

        const response = await fetch("/api/chapa", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            cardSerial: card.serialNumber,
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Chapa payment failed.");
        }

        const updatedBalance = Number(
          (card.balance + TOP_UP_AMOUNT).toFixed(2),
        );
        await writeBalanceToCard(updatedBalance);

        setCard({
          balance: updatedBalance,
          serialNumber: card.serialNumber,
          lastSynced: new Date().toISOString(),
        });
        setPaymentReference(payload.txRef ?? null);
        setStatus({
          tone: "success",
          message:
            "Chapa checkout launched in a new tab and the card is preloaded with +1 ETB for the demo.",
        });
        const checkoutUrl: string | undefined =
          payload.checkoutUrl ?? payload.data?.checkout_url;
        if (typeof window !== "undefined" && checkoutUrl) {
          window.open(checkoutUrl, "_blank", "noopener,noreferrer");
        }
      } catch (error) {
        console.error(error);
        setStatus({
          tone: "alert",
          message:
            error instanceof Error
              ? error.message
              : "Unable to reach Chapa right now.",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [card, writeBalanceToCard, TOP_UP_AMOUNT],
  );

  return (
    <div className="min-h-screen bg-[#FDF9F0] px-4 py-10">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="rounded-3xl border border-[#F5AD00]/30 bg-white p-5 shadow-[0_20px_60px_rgba(44,46,123,0.08)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-[#ED8800]">
                ELPA pilot
              </p>
              <h1 className="text-2xl font-semibold text-[#2C2E7B]">
                NFC balance & Chapa refill
              </h1>
              <p className="text-sm text-[#595959]">
                Step 1 read card · Step 2 pay 1 ETB via Chapa · Step 3 auto write
                the new balance.
              </p>
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

        <section className="rounded-3xl border border-[#F5AD00]/40 bg-[#FFF6E1] p-5 shadow-inner">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-[#F5AD00]">
                Balance
              </p>
              <p className="text-4xl font-semibold text-[#2C2E7B]">
                {card ? formatETB(card.balance) : "--"}
              </p>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 text-xs text-[#595959] shadow-sm">
              <p className="font-semibold text-[#2C2E7B]">
                {card?.serialNumber ?? "No card read yet"}
              </p>
              {card?.lastSynced && (
                <p>
                  Updated{" "}
                  {new Date(card.lastSynced).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>
          </div>

          <div
            className={`mt-4 rounded-2xl px-4 py-3 text-sm ${
              status.tone === "success"
                ? "bg-white text-[#2C2E7B]"
                : status.tone === "alert"
                  ? "bg-[#FDE2D9] text-[#9E2F1B]"
                  : "bg-[#FFEFD1] text-[#7C4A00]"
            }`}
          >
            {status.message}
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleReadCard}
              disabled={isReading || isWriting}
              className="flex-1 rounded-2xl bg-[#F5AD00] py-3 text-center text-base font-semibold text-[#2C2E7B] transition hover:bg-[#ED8800] disabled:cursor-not-allowed disabled:bg-[#F5AD00]/50"
            >
              {isReading ? "Listening…" : "Read NFC card"}
            </button>
            {card && (
              <button
                type="button"
                onClick={() => writeBalanceToCard(card.balance)}
                disabled={isWriting}
                className="flex-1 rounded-2xl border border-[#2C2E7B]/20 bg-white py-3 text-center text-base font-semibold text-[#2C2E7B] transition hover:bg-[#F0F2FF] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isWriting ? "Writing…" : "Write current balance again"}
              </button>
            )}
          </div>
          {needsReset && (
            <button
              type="button"
              onClick={() => writeBalanceToCard(0)}
              disabled={isWriting}
              className="mt-3 w-full rounded-2xl border border-[#F44C24]/40 bg-white py-3 text-sm font-semibold text-[#9E2F1B] transition hover:bg-[#FFF2EE] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isWriting ? "Writing…" : "Reset card to 0 ETB"}
            </button>
          )}

          <p className="mt-3 text-center text-xs text-[#595959]">
            Tip: Enable NFC, keep Chrome in the foreground, and tap the card on
            the back camera area.
          </p>
        </section>

        <section className="rounded-3xl border border-[#2C2E7B]/10 bg-white p-6 shadow-[0_30px_80px_rgba(0,0,0,0.05)]">
          <form className="space-y-4" onSubmit={handleChapaRefill}>
            <div className="rounded-2xl border border-[#007FA3]/10 bg-[#E4F4F9] px-4 py-4 text-sm text-[#00516E]">
              <p className="font-semibold text-[#007FA3]">Chapa checkout</p>
              <p className="mt-1">
                Every tap charges exactly {formatETB(TOP_UP_AMOUNT)}. Checkout
                opens in a new tab and this demo immediately pushes the extra 1
                ETB onto the card.
              </p>
            </div>

            {paymentReference && (
              <div className="rounded-2xl border border-[#F5AD00]/30 bg-[#FFF6E1] px-4 py-3 text-xs text-[#7C4A00]">
                Chapa ref: {paymentReference}
              </div>
            )}

            <button
              type="submit"
              disabled={isProcessing || isWriting}
              className="w-full rounded-2xl bg-[#2C2E7B] py-4 text-lg font-semibold text-white transition hover:bg-[#1e2060] disabled:cursor-not-allowed disabled:bg-[#2C2E7B]/50"
            >
              {isProcessing ? "Connecting to Chapa…" : "Pay 1 ETB with Chapa"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
