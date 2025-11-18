import { NextResponse } from "next/server";

const CHAPA_ENDPOINT = "https://api.chapa.co/v1/transaction/initialize";

export async function POST(request: Request) {
  if (!process.env.CHAPA_SECRET_KEY) {
    return NextResponse.json(
      { error: "Server missing CHAPA_SECRET_KEY environment variable." },
      { status: 500 },
    );
  }

  try {
    const { amount: userAmount, cardSerial } = await request
      .json()
      .catch(() => ({ amount: 50, cardSerial: "UNKNOWN" }));

    const txRef = `ELPA-${Date.now()}`;
    const origin = request.headers.get("origin") ?? "http://localhost:3000";

    const payload = {
      // amount: userAmount,
      amount: "1",
      currency: "ETB",
      // phone_number: "+251911000000",
      tx_ref: txRef,
      return_url: `${origin}/chapa/return?tx_ref=${txRef}`,
      callback_url: `${origin}/api/chapa/callback`,
      meta: {
        cardSerial: cardSerial ?? "UNKNOWN",
        userAmount: String(userAmount ?? 50),
      },
      customization: {
        title: "ELPA NFC refill",
        description: "NFC top-up demo via Chapa",
      },
    };

    const chapaResponse = await fetch(CHAPA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const chapaPayload = await chapaResponse.json();

    if (!chapaResponse.ok) {
      console.error("Chapa API error:", chapaPayload);
      
      let errorMessage = "Unable to initialize Chapa payment.";
      
      if (chapaPayload?.message) {
        errorMessage = chapaPayload.message;
      } else if (chapaPayload?.error) {
        if (typeof chapaPayload.error === "string") {
          errorMessage = chapaPayload.error;
        } else if (chapaPayload.error?.email) {
          errorMessage = `Email validation failed: ${JSON.stringify(chapaPayload.error.email)}`;
        } else {
          errorMessage = `Validation error: ${JSON.stringify(chapaPayload.error)}`;
        }
      } else if (chapaPayload?.errors) {
        errorMessage = `Validation errors: ${JSON.stringify(chapaPayload.errors)}`;
      }
      
      return NextResponse.json(
        {
          error: errorMessage,
          details: chapaPayload,
        },
        { status: chapaResponse.status },
      );
    }

    const checkoutUrl =
      chapaPayload?.data?.checkout_url ??
      chapaPayload?.checkout_url ??
      chapaPayload?.data?.checkoutUrl ??
      null;

    if (!checkoutUrl) {
      console.error("Chapa response missing checkout_url:", chapaPayload);
      return NextResponse.json(
        {
          error: "Chapa did not return a checkout URL. Check server logs.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      checkoutUrl,
      txRef,
    });
  } catch (error) {
    console.error("Chapa initialization failed", error);
    return NextResponse.json(
      { error: "Unexpected error while talking to Chapa." },
      { status: 500 },
    );
  }
}

