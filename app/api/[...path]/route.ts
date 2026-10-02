import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { atender } = require("@/backend");

// Prisma + mysql necesitan Node (no Edge) y las respuestas nunca se cachean.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function manejar(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const { status, body } = await atender(request, path);
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export {
  manejar as GET,
  manejar as POST,
  manejar as PUT,
  manejar as PATCH,
  manejar as DELETE,
};
