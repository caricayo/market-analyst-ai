import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "root",
    timestamp: new Date().toISOString(),
  });
}
