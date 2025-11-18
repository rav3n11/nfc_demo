import { NextRequest, NextResponse } from "next/server";

const CHAPA_VERIFY_ENDPOINT = "https://api.chapa.co/v1/transaction/verify/";

export async function GET(request: NextRequest) {
  if (!process.env.CHAPA_SECRET_KEY) {
    return NextResponse.json(
      { error: "Server missing CHAPA_SECRET_KEY environment variable." },
      { status: 500 },
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const txRef = searchParams.get("tx_ref");

  if (!txRef) {
    return NextResponse.json(
      { error: "Missing transaction reference (tx_ref)." },
      { status: 400 },
    );
  }

  try {
    const chapaResponse = await fetch(`${CHAPA_VERIFY_ENDPOINT}${txRef}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const chapaPayload = await chapaResponse.json();

    if (!chapaResponse.ok) {
      return NextResponse.json(
        {
          error: chapaPayload?.message ?? "Unable to verify payment with Chapa.",
        },
        { status: chapaResponse.status },
      );
    }

    const status = chapaPayload?.status === "success" ? "success" : "failed";
    const userAmount =
      chapaPayload?.data?.meta?.userAmount ??
      chapaPayload?.meta?.userAmount ??
      "50";

    return NextResponse.json({
      status,
      txRef,
      userAmount: Number(userAmount),
      chapaData: chapaPayload?.data ?? null,
    });
  } catch (error) {
    console.error("Chapa verification failed", error);
    return NextResponse.json(
      { error: "Unexpected error while verifying payment with Chapa." },
      { status: 500 },
    );
  }
}

