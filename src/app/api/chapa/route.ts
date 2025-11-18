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
    const { cardSerial } = await request
      .json()
      .catch(() => ({ cardSerial: "UNKNOWN" }));

    const txRef = `ELPA-${Date.now()}`;
    const origin = request.headers.get("origin") ?? "http://localhost:3000";

    const payload = {
      amount: "1",
      currency: "ETB",
      email: "demo@elpa.et",
      first_name: "ELPA",
      last_name: "Pilot",
      phone_number: "+251911000000",
      tx_ref: txRef,
      return_url: `${origin}/chapa/return`,
      callback_url: `${origin}/api/chapa/callback`,
      meta: {
        cardSerial: cardSerial ?? "UNKNOWN",
      },
      customization: {
        title: "ELPA NFC refill",
        description: "1 ETB NFC top-up demo via Chapa",
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
      return NextResponse.json(
        {
          error: chapaPayload?.message ?? "Unable to initialize Chapa payment.",
        },
        { status: chapaResponse.status },
      );
    }

    return NextResponse.json({
      checkoutUrl: chapaPayload?.data?.checkout_url ?? null,
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

