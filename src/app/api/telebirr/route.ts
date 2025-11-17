import { NextResponse } from "next/server";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  try {
    const { amount, cardSerial } = await request.json();

    if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be a number greater than zero." },
        { status: 400 },
      );
    }

    await wait(1200);

    return NextResponse.json({
      transactionId: `TB-${Math.floor(Date.now() / 1000)}`,
      status: "SUCCESS",
      amount,
      cardSerial: cardSerial ?? null,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Telebirr mock API failed", error);
    return NextResponse.json(
      { error: "Unable to reach Telebirr gateway." },
      { status: 500 },
    );
  }
}

