"use client";

import Image from "next/image";
import Confetti from "react-confetti";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  Suspense,
} from "react";
import { useSearchParams } from "next/navigation";

type CardSnapshot = {
  balance: number;
  serialNumber: string;
  lastSynced: string;
};

type StatusTone = "info" | "success" | "alert";

type PendingPayment = {
  userAmount: number;
  txRef: string;
  cardSerial: string;
  processedAt: string;
};

type ReceiptData = {
  txRef: string;
  amount: number;
  vat: number;
  serviceFee: number;
  total: number;
  branchName: string;
  branchCode: string;
  customerName: string;
  phone: string;
  address: string;
  reason: string;
  initiatedAt: string;
  finalizedAt: string;
};

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

type FlowMode = "home" | "check-status" | "refill";

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

function HomeContent() {
  const [flowMode, setFlowMode] = useState<FlowMode>("home");
  const [card, setCard] = useState<CardSnapshot | null>(null);
  const [amount, setAmount] = useState("50");
  const [paymentReference, setPaymentReference] = useState<string | null>(null);
  const [needsReset, setNeedsReset] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const MAX_AMOUNT = 10000;

  const [status, setStatus] = useState<{ tone: StatusTone; message: string }>({
    tone: "info",
    message: "Android Chrome + NFC only. Select an option to begin.",
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

  useEffect(() => {
    const updateViewport = () => {
      if (typeof window !== "undefined") {
        setViewport({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      }
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (!showConfetti) return;
    const timeout = setTimeout(() => setShowConfetti(false), 6000);
    return () => clearTimeout(timeout);
  }, [showConfetti]);

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

  const searchParams = useSearchParams();

  useEffect(() => {
    const verifyPaymentFromUrl = async () => {
      const txRef = searchParams.get("tx_ref");
      if (!txRef) return;

      setIsVerifying(true);
      setStatus({
        tone: "info",
        message: "Verifying payment with Chapa…",
      });

      try {
        const response = await fetch(`/api/chapa/verify?tx_ref=${txRef}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Payment verification failed.");
        }

        if (payload.status === "success") {
          const storedCard = localStorage.getItem("chapa_pending_card");
          if (storedCard) {
            const cardInfo = JSON.parse(storedCard);
            setPendingPayment({
              userAmount: payload.userAmount ?? cardInfo.userAmount ?? 50,
              txRef: payload.txRef ?? txRef,
              cardSerial: cardInfo.serialNumber,
              processedAt: payload.processedAt ?? new Date().toISOString(),
            });
            setFlowMode("refill");
            setStatus({
              tone: "success",
              message: `Payment confirmed! Read your card to apply +${formatETB(payload.userAmount ?? cardInfo.userAmount ?? 50)}.`,
            });
          } else {
            setStatus({
              tone: "alert",
              message: "Payment confirmed but card info was lost. Please start over.",
            });
          }
          localStorage.removeItem("chapa_pending_card");
        } else {
          setStatus({
            tone: "alert",
            message: "Payment was not completed.",
          });
        }
      } catch (error) {
        console.error(error);
        setStatus({
          tone: "alert",
          message:
            error instanceof Error
              ? error.message
              : "Unable to verify payment.",
        });
      } finally {
        setIsVerifying(false);
        window.history.replaceState({}, "", "/");
      }
    };

    verifyPaymentFromUrl();
  }, [searchParams]);

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
      ndef.onreading = async (event: NDEFReadingEvent) => {
        const balanceFromCard = extractBalance(event.message);
        const cardSerial = event.serialNumber ?? "Unknown card";
        
        if (balanceFromCard === null) {
          setNeedsReset(true);
          setStatus({
            tone: "alert",
            message:
              "Card detected but no balance was found. Tap “Reset to 0 ETB” to initialize.",
          });
          setIsReading(false);
          return;
        }

        setNeedsReset(false);
        const newCard = {
          balance: balanceFromCard,
          serialNumber: cardSerial,
          lastSynced: new Date().toISOString(),
        };
        setCard(newCard);
        
        const currentPendingPayment = pendingPayment;
        if (currentPendingPayment && currentPendingPayment.cardSerial === cardSerial) {
          setPendingPayment(null);
          
          setStatus({
            tone: "info",
            message: `Applying payment of +${formatETB(currentPendingPayment.userAmount)} to card…`,
          });
          
          const updatedBalance = Number(
            (balanceFromCard + currentPendingPayment.userAmount).toFixed(2),
          );
          
          try {
            await writeBalanceToCard(updatedBalance);
            setCard({
              ...newCard,
              balance: updatedBalance,
            });
            setPaymentReference(currentPendingPayment.txRef);
            
            // Generate receipt
            const receiptData: ReceiptData = {
              txRef: currentPendingPayment.txRef,
              amount: currentPendingPayment.userAmount,
              vat: Number((currentPendingPayment.userAmount * 0.15).toFixed(2)),
              serviceFee: Number((currentPendingPayment.userAmount * 0.015).toFixed(2)),
              total: Number((currentPendingPayment.userAmount * 1.165).toFixed(2)),
              branchName: "",
              branchCode: "",
              customerName: "",
              phone: "",
              address: "",
              reason: "NFC Card Refill",
              initiatedAt: new Date(currentPendingPayment.processedAt).toLocaleString(),
              finalizedAt: new Date().toLocaleString(),
            };
            setReceipt(receiptData);
            setShowConfetti(true);
            setStatus({
              tone: "success",
              message: `Card updated! Added ${formatETB(currentPendingPayment.userAmount)}. New balance: ${formatETB(updatedBalance)}.`,
            });
          } catch (error) {
            setPendingPayment(currentPendingPayment);
            setStatus({
              tone: "alert",
              message: "Failed to write to card. Please try again.",
            });
          }
        } else {
          if (flowMode === "check-status") {
            setStatus({
              tone: "success",
              message: `Card balance: ${formatETB(balanceFromCard)}`,
            });
          } else {
            setStatus({
              tone: "success",
              message: "Balance pulled directly from the card.",
            });
          }
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
  }, [nfcSupported, pendingPayment, writeBalanceToCard, flowMode]);

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
      const parsedAmount = Number(amount);
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        setStatus({
          tone: "alert",
          message: "Amount has to be greater than zero.",
        });
        return;
      }
      if (parsedAmount > MAX_AMOUNT) {
        setStatus({
          tone: "alert",
          message: `Maximum top-up per tap is ${formatETB(MAX_AMOUNT)}.`,
        });
        return;
      }
      try {
        setIsProcessing(true);
        setPaymentReference(null);
        setDebugInfo(null);
        setStatus({
          tone: "info",
          message: "Connecting to Chapa…",
        });

        if (typeof window !== "undefined") {
          localStorage.setItem(
            "chapa_pending_card",
            JSON.stringify({
              serialNumber: card.serialNumber,
              balance: card.balance,
              userAmount: parsedAmount,
            }),
          );
        }

        setDebugInfo("Sending request to /api/chapa...");
        const response = await fetch("/api/chapa", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: parsedAmount,
            cardSerial: card.serialNumber,
          }),
        });

        setDebugInfo(`Response status: ${response.status}`);
        const payload = await response.json();
        
        if (!response.ok) {
          const errorMsg = payload.error ?? "Chapa payment failed.";
          setDebugInfo(`Error: ${errorMsg} | Full response: ${JSON.stringify(payload)}`);
          throw new Error(errorMsg);
        }

        const checkoutUrl: string | undefined =
          payload.checkoutUrl ?? payload.data?.checkout_url;
        
        setDebugInfo(`Got checkout URL: ${checkoutUrl ? "Yes" : "No"} | Response: ${JSON.stringify(payload).substring(0, 200)}`);
        
        if (typeof window !== "undefined" && checkoutUrl) {
          setStatus({
            tone: "info",
            message: "Redirecting to Chapa now…",
          });
          setDebugInfo(`Redirecting to: ${checkoutUrl}`);
          setTimeout(() => {
            window.location.href = checkoutUrl;
          }, 500);
        } else {
          const errorMsg = payload.error ?? "Chapa did not return a checkout URL.";
          setDebugInfo(`No checkout URL. Response: ${JSON.stringify(payload)}`);
          throw new Error(errorMsg);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error occurred.";
        setStatus({
          tone: "alert",
          message: errorMsg,
        });
        setIsProcessing(false);
      }
    },
    [amount, card, MAX_AMOUNT],
  );

  const resetToHome = () => {
    setFlowMode("home");
    setCard(null);
    setAmount("50");
    setPaymentReference(null);
    setReceipt(null);
    setPendingPayment(null);
    setStatus({
      tone: "info",
      message: "Android Chrome + NFC only. Select an option to begin.",
    });
  };

  const refillSteps = useMemo(() => {
    const steps = [
      {
        title: "Read card",
        isCompleted: card !== null,
        isCurrent: flowMode === "refill" && card === null && !pendingPayment,
      },
      {
        title: "Fill amount",
        isCompleted: pendingPayment !== null || receipt !== null,
        isCurrent: flowMode === "refill" && card !== null && !pendingPayment && !receipt,
      },
      {
        title: "Pay",
        isCompleted: receipt !== null,
        isCurrent: flowMode === "refill" && pendingPayment !== null && !receipt,
      },
      {
        title: "Receipt",
        isCompleted: receipt !== null,
        isCurrent: flowMode === "refill" && receipt !== null,
      },
    ];
    return steps;
  }, [flowMode, card, pendingPayment, receipt]);

  const handleBack = () => {
    if (flowMode === "home") {
      window.location.href = "https://app.vps.gebeta.app";
    } else {
      resetToHome();
    }
  };

  return (
    <div className="relative min-h-screen bg-[#f5f6fb] text-[#1f2a44]">
      {showConfetti && (
        <Confetti
          width={viewport.width}
          height={viewport.height}
          recycle={true}
          numberOfPieces={30}
          gravity={0.2}
          initialVelocityY={20}
          initialVelocityX={10}
          wind={0.1}
          opacity={0.9}
          colors={['#4CAF50', '#81C784', '#FFD700', '#4FC3F7', '#FF8A65']}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 9999
          }}
        />
      )}


      <main className="mx-auto w-full max-w-4xl px-3 sm:px-4">
        {/* Home Screen */}
        {flowMode === "home" && (
          <div className="space-y-4 sm:space-y-6">
            {/* Blue Rounded Top Bar with Balance */}
            <div className="bg-[#2C2E7B] rounded-b-3xl sm:rounded-b-[2rem] pt-6 pb-8 sm:pt-8 sm:pb-10 px-4 sm:px-6 -mx-3 sm:-mx-4">
              <div className="flex items-center justify-between mb-6">
                <button
                  onClick={handleBack}
                  className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg text-white transition hover:bg-white/20"
                  aria-label="Back"
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 12H5M12 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="flex items-center gap-3 sm:gap-4">
                  <Image
                    src="/elpa.svg"
                    alt="Ethiopian Electric logo"
                    width={120}
                    height={90}
                    className="h-12 sm:h-16 w-auto"
                    priority
                  />
                  <span className="h-8 sm:h-10 w-px bg-white/30" aria-hidden />
        <Image
                    src="/ethiopost-logo.svg"
                    alt="Ethiopost logo"
                    width={80}
                    height={80}
                    className="h-10 sm:h-12 w-auto"
          priority
        />
                </div>
              </div>

              {/* Balance Display */}
              <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs sm:text-sm font-medium text-[#8a94b4] uppercase tracking-wider">
                    Card Balance
                  </p>
                  {card && (
                    <button
                      onClick={handleReadCard}
                      disabled={isReading}
                      className="flex items-center gap-1 text-xs text-[#2C2E7B] hover:text-[#F5AD00] transition disabled:opacity-50"
                      aria-label="Refresh balance"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={isReading ? "animate-spin" : ""}
                      >
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                      </svg>
                      <span className="hidden sm:inline">Refresh</span>
                    </button>
                  )}
                </div>
                {card ? (
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-3xl sm:text-4xl font-bold text-[#2C2E7B]">
                        {formatETB(card.balance)}
                      </p>
                      <p className="text-xs sm:text-sm text-[#8a94b4] mt-1">
                        Card: {card.serialNumber.slice(0, 8)}...
                      </p>
                    </div>
                    <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl bg-[#F5AD00]/20 flex items-center justify-center">
                      <span className="text-lg sm:text-xl font-bold text-[#F5AD00]">
                        {card.serialNumber.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl sm:text-3xl font-semibold text-[#8a94b4]">
                        No card read
                      </p>
                      <p className="text-xs sm:text-sm text-[#8a94b4] mt-1">
                        Tap a card to view balance
                      </p>
                    </div>
                    <button
                      onClick={handleReadCard}
                      disabled={isReading}
                      className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl bg-[#F5AD00] flex items-center justify-center text-white hover:bg-[#ED8800] transition disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Read card"
                    >
                      {isReading ? (
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="animate-spin"
                        >
                          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
                        </svg>
                      ) : (
                        <svg
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                        </svg>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Feature Cards */}
            <div className="px-0 pb-4 sm:pb-6">
              <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
                <button
                  onClick={() => {
                    setFlowMode("check-status");
                    setStatus({
                      tone: "info",
                      message: "Tap 'Read NFC card' to check the balance.",
                    });
                  }}
                  className="group rounded-xl sm:rounded-2xl border border-[#e4e6f3] bg-white p-4 sm:p-6 text-left transition hover:border-[#F5AD00] hover:shadow-md"
                >
                  <div className="mb-3 sm:mb-4 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-[#F5AD00]/10 group-hover:bg-[#F5AD00]/20">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#F5AD00"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                  </div>
                  <h3 className="mb-1 sm:mb-2 text-base sm:text-lg font-semibold text-[#2C2E7B]">
                    Check Card Status
                  </h3>
                  <p className="text-xs sm:text-sm text-[#5d6b8b]">
                    Read your NFC card to view the current balance
                  </p>
                </button>

                <button
                  onClick={() => {
                    setFlowMode("refill");
                    setCard(null);
                    setStatus({
                      tone: "info",
                      message: "Start by reading your card to begin the refill process.",
                    });
                  }}
                  className="group rounded-xl sm:rounded-2xl border border-[#e4e6f3] bg-white p-4 sm:p-6 text-left transition hover:border-[#F5AD00] hover:shadow-md"
                >
                  <div className="mb-3 sm:mb-4 flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-[#2C2E7B]/10 group-hover:bg-[#2C2E7B]/20">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#2C2E7B"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </div>
                  <h3 className="mb-1 sm:mb-2 text-base sm:text-lg font-semibold text-[#2C2E7B]">
                    Refill Card
                  </h3>
                  <p className="text-xs sm:text-sm text-[#5d6b8b]">
                    Add balance to your card via Chapa payment
                  </p>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Check Status Flow */}
        {flowMode === "check-status" && (
          <div className="space-y-4 sm:space-y-6">
            {/* Back Button */}
            <div className="flex items-center pt-4">
              <button
                onClick={resetToHome}
                className="flex items-center gap-2 text-sm font-medium text-[#2C2E7B] transition hover:text-[#F5AD00]"
                aria-label="Back to home"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span>Back</span>
              </button>
            </div>

            <div className="rounded-2xl sm:rounded-3xl border border-[#e4e6f3] bg-white p-4 sm:p-6 shadow-[0_20px_60px_rgba(44,46,123,0.08)]">
              <h2 className="mb-4 text-xl sm:text-2xl font-semibold text-[#2C2E7B]">
                Check Card Status
              </h2>

              {card && (
                <div className="mb-4 sm:mb-6 rounded-xl sm:rounded-2xl border border-[#e1e3f0] bg-[#f8f9ff] p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-[#8a94b4]">
                        Current Balance
                      </p>
                      <p className="mt-1 text-3xl sm:text-4xl font-bold text-[#2C2E7B]">
                        {formatETB(card.balance)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white px-3 sm:px-4 py-2 sm:py-3 text-sm">
                      <p className="font-semibold text-[#2C2E7B] text-xs sm:text-sm break-all">
                        {card.serialNumber}
                      </p>
                      <p className="text-xs text-[#8a94b4]">
                        {new Date(card.lastSynced).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div
                className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
                  status.tone === "success"
                    ? "bg-white text-[#2C2E7B]"
                    : status.tone === "alert"
                      ? "bg-[#FDE2D9] text-[#9E2F1B]"
                      : "bg-[#FFEFD1] text-[#7C4A00]"
                }`}
              >
                {status.message}
              </div>

              <button
                type="button"
                onClick={handleReadCard}
                disabled={isReading || isWriting}
                className="w-full rounded-2xl bg-[#F5AD00] py-4 text-center text-base font-semibold text-[#2C2E7B] transition hover:bg-[#ED8800] disabled:cursor-not-allowed disabled:bg-[#F5AD00]/50"
              >
                {isReading ? "Listening…" : "Read NFC card"}
              </button>

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
            </div>
          </div>
        )}

        {/* Refill Flow */}
        {flowMode === "refill" && (
          <div className="space-y-4 sm:space-y-6">
            {/* Back Button */}
            <div className="flex items-center pt-4">
              <button
                onClick={resetToHome}
                className="flex items-center gap-2 text-sm font-medium text-[#2C2E7B] transition hover:text-[#F5AD00]"
                aria-label="Back to home"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                <span>Back</span>
              </button>
            </div>

            {/* Stepper */}
            <div className="rounded-2xl sm:rounded-3xl border border-[#e4e6f3] bg-white p-4 sm:p-6 shadow-[0_20px_60px_rgba(44,46,123,0.08)]">
              <div className="mb-4 sm:mb-6">
                <h2 className="mb-4 text-xl sm:text-2xl font-semibold text-[#2C2E7B]">
                  Refill Card
                </h2>
                <div className="relative flex items-center">
                  {refillSteps.map((step, index) => (
                    <div key={index} className="relative flex flex-1 items-center">
                      <div className="relative z-10 flex flex-col items-center w-full">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                            step.isCompleted
                              ? "border-[#F5AD00] bg-[#F5AD00] text-white"
                              : step.isCurrent
                                ? "border-[#F5AD00] bg-[#FFF1D1] text-[#F5AD00]"
                                : "border-[#d0d4e6] bg-white text-[#b1b7ce]"
                          }`}
                        >
                          {step.isCompleted ? (
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <span className="text-sm font-semibold">{index + 1}</span>
                          )}
                        </div>
                        <p
                          className={`mt-2 text-xs font-medium ${
                            step.isCurrent || step.isCompleted
                              ? "text-[#2C2E7B]"
                              : "text-[#b1b7ce]"
                          }`}
                        >
                          {step.title}
          </p>
        </div>
                      {index < refillSteps.length - 1 && (
                        <div
                          className={`absolute left-1/2 h-0.5 w-full ${
                            step.isCompleted ? "bg-[#F5AD00]" : "bg-[#d0d4e6]"
                          }`}
                          style={{
                            top: '20px',
                            transform: 'translateY(-50%)',
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Step 1: Read Card */}
            {!card && !pendingPayment && !receipt && (
              <div className="rounded-2xl sm:rounded-3xl border border-[#e4e6f3] bg-white p-4 sm:p-6 shadow-[0_20px_60px_rgba(44,46,123,0.08)]">
                <h3 className="mb-4 text-lg sm:text-xl font-semibold text-[#2C2E7B]">
                  Step 1: Read Your Card
                </h3>
                <div
                  className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
                    status.tone === "success"
                      ? "bg-white text-[#2C2E7B]"
                      : status.tone === "alert"
                        ? "bg-[#FDE2D9] text-[#9E2F1B]"
                        : "bg-[#FFEFD1] text-[#7C4A00]"
                  }`}
                >
                  {status.message}
                </div>
                <button
                  type="button"
                  onClick={handleReadCard}
                  disabled={isReading || isWriting}
                  className="w-full rounded-2xl bg-[#F5AD00] py-4 text-center text-base font-semibold text-[#2C2E7B] transition hover:bg-[#ED8800] disabled:cursor-not-allowed disabled:bg-[#F5AD00]/50"
                >
                  {isReading ? "Listening…" : "Read NFC card"}
                </button>
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
              </div>
            )}

            {/* Step 2: Fill Amount */}
            {card && !pendingPayment && !receipt && (
              <div className="rounded-2xl sm:rounded-3xl border border-[#e4e6f3] bg-white p-4 sm:p-6 shadow-[0_20px_60px_rgba(44,46,123,0.08)]">
                <h3 className="mb-4 text-lg sm:text-xl font-semibold text-[#2C2E7B]">
                  Step 2: Enter Refill Amount
                </h3>
                <form className="space-y-4" onSubmit={handleChapaRefill}>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-[#2C2E7B]">
                      Refill amount (ETB)
                    </label>
                    <input
                      type="number"
                      min={5}
                      step={5}
                      max={MAX_AMOUNT}
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-2xl font-semibold text-slate-900 outline-none focus:border-[#F5AD00]"
                    />
                    <p className="mt-1 text-xs text-[#595959]">
                      Minimum 5 ETB, maximum {formatETB(MAX_AMOUNT)} per refill.
                    </p>
                  </div>

                  {debugInfo && (
                    <div className="rounded-2xl border border-[#007FA3]/30 bg-[#E4F4F9] px-4 py-3 text-xs text-[#00516E] break-words">
                      <p className="mb-1 font-semibold">Debug info:</p>
                      <p className="font-mono text-[10px]">{debugInfo}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isProcessing || isWriting}
                    className="w-full rounded-2xl bg-[#2C2E7B] py-4 text-lg font-semibold text-white transition hover:bg-[#1e2060] disabled:cursor-not-allowed disabled:bg-[#2C2E7B]/50"
                  >
                    {isProcessing ? "Redirecting to Chapa…" : "Pay with Chapa"}
                  </button>
                </form>
              </div>
            )}

            {/* Step 3: Pay (Pending Payment) */}
            {pendingPayment && !receipt && (
              <div className="rounded-2xl sm:rounded-3xl border border-[#e4e6f3] bg-white p-4 sm:p-6 shadow-[0_20px_60px_rgba(44,46,123,0.08)]">
                <h3 className="mb-4 text-lg sm:text-xl font-semibold text-[#2C2E7B]">
                  Step 3: Apply Payment to Card
                </h3>
                {isVerifying && (
                  <div className="mb-4 rounded-2xl border border-[#007FA3]/30 bg-[#E4F4F9] px-4 py-3 text-sm text-[#00516E]">
                    Verifying payment with Chapa…
                  </div>
                )}
                <div className="mb-4 rounded-2xl border border-[#F5AD00]/40 bg-[#FFF6E1] px-4 py-3 text-sm text-[#7C4A00]">
                  <p className="font-semibold">Payment confirmed!</p>
                  <p className="mt-1 text-xs">
                    Ready to add {formatETB(pendingPayment.userAmount)}. Read your card to apply.
                  </p>
                </div>
                <div
                  className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
                    status.tone === "success"
                      ? "bg-white text-[#2C2E7B]"
                      : status.tone === "alert"
                        ? "bg-[#FDE2D9] text-[#9E2F1B]"
                        : "bg-[#FFEFD1] text-[#7C4A00]"
                  }`}
                >
                  {status.message}
                </div>
                <button
                  type="button"
                  onClick={handleReadCard}
                  disabled={isReading || isWriting}
                  className="w-full rounded-2xl bg-[#F5AD00] py-4 text-center text-base font-semibold text-[#2C2E7B] transition hover:bg-[#ED8800] disabled:cursor-not-allowed disabled:bg-[#F5AD00]/50"
                >
                  {isReading ? "Listening…" : "Read NFC card to apply payment"}
                </button>
              </div>
            )}

            {/* Step 4: Receipt */}
            {receipt && (
              <div className="rounded-2xl sm:rounded-3xl border border-[#e1e3f0] bg-white p-4 sm:p-6 shadow-[0_20px_50px_rgba(31,42,68,0.08)]">
                <h3 className="mb-4 text-lg sm:text-xl font-semibold text-[#2C2E7B]">
                  Payment Receipt
                </h3>
                
                <div className="mb-4 space-y-3">
                  <div className="rounded-xl sm:rounded-2xl border border-[#f1f2f8] bg-[#fdfaf3] p-3 sm:p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-[#8a94b4] mb-2">
                      Transaction
                    </p>
                    <p className="text-sm font-semibold text-[#2C2E7B] mb-1">{receipt.reason}</p>
                    <p className="text-xs text-[#6c7899]">Ref: {receipt.txRef}</p>
                    <p className="text-xs text-[#6c7899] mt-1">
                      {receipt.finalizedAt}
                    </p>
                  </div>
                  
                  <div className="rounded-xl sm:rounded-2xl border border-[#f1f2f8] bg-white p-3 sm:p-4">
                    <div className="flex items-center justify-between text-sm text-[#2C2E7B] mb-2">
                      <p>Amount</p>
                      <p className="font-semibold">{formatETB(receipt.amount)}</p>
                    </div>
                    <div className="flex items-center justify-between text-sm text-[#2C2E7B] mb-2">
                      <p>VAT (15%)</p>
                      <p>{formatETB(receipt.vat)}</p>
                    </div>
                    <div className="flex items-center justify-between text-sm text-[#2C2E7B] mb-2">
                      <p>Service fee (1.5%)</p>
                      <p>{formatETB(receipt.serviceFee)}</p>
                    </div>
                    <div className="flex items-center justify-between border-t border-dashed border-[#dfe2f1] pt-2 mt-2 text-base font-semibold text-[#2C2E7B]">
                      <p>Total</p>
                      <p className="text-[#388e3c]">{formatETB(receipt.total)}</p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-[#f1f2f8]">
                      <p className="text-xs text-[#6c7899] text-center">Paid via Chapa</p>
                    </div>
                  </div>
                  
                  <div className="rounded-xl sm:rounded-2xl border border-[#f1f2f8] bg-white p-3 sm:p-4 text-center">
                    <p className="text-xs uppercase tracking-[0.3em] text-[#8a94b4] mb-2">
                      Card Code
                    </p>
                    <p className="text-xl sm:text-2xl font-semibold text-[#2C2E7B] mb-2">
                      {card?.serialNumber?.slice(0, 6) ?? "------"}
                    </p>
                    <p className="text-xs text-[#8a94b4]">Thank you!</p>
                  </div>
                </div>
                
                <button
                  onClick={resetToHome}
                  className="w-full rounded-xl sm:rounded-2xl bg-[#2C2E7B] py-3 sm:py-4 text-base sm:text-lg font-semibold text-white transition hover:bg-[#1e2060]"
                >
                  Back to Home
                </button>
              </div>
            )}
        </div>
        )}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#FDF9F0] px-4 py-10">
          <div className="text-center">
            <p className="text-[#2C2E7B]">Loading…</p>
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
