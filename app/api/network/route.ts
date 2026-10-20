export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { networkInterfaces } from "os";
import { NextRequest, NextResponse } from "next/server";

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.startsWith("127.");
}

function getLocalIpv4Addresses() {
  const addresses = new Set<string>();
  const interfaces = networkInterfaces();

  for (const networkInterface of Object.values(interfaces)) {
    for (const addressInfo of networkInterface || []) {
      if (addressInfo.family === "IPv4" && !addressInfo.internal) {
        addresses.add(addressInfo.address);
      }
    }
  }

  return Array.from(addresses);
}

function splitHostAndPort(hostHeader: string) {
  const host = hostHeader.trim();

  if (host.startsWith("[")) {
    const closingBracketIndex = host.indexOf("]");
    const hostname = host.slice(1, closingBracketIndex);
    const port = host.slice(closingBracketIndex + 1).replace(/^:/, "");
    return { hostname, port };
  }

  const [hostname, port = ""] = host.split(":");
  return { hostname, port };
}

export async function GET(req: NextRequest) {
  const hostHeader = req.headers.get("host") || "localhost:3000";
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ? forwardedProto.split(/,\s*/)[0] : "http";
  const { hostname, port } = splitHostAndPort(hostHeader);
  const portSuffix = port && port !== "80" && port !== "443" ? `:${port}` : "";
  const currentOrigin = `${protocol}://${hostHeader}`;
  const networkOrigins = getLocalIpv4Addresses().map((address) => `${protocol}://${address}${portSuffix}`);
  const preferredOrigin = isLoopbackHost(hostname) && networkOrigins.length > 0
    ? networkOrigins[0]
    : currentOrigin;

  return NextResponse.json({
    success: true,
    currentOrigin,
    preferredOrigin,
    networkOrigins,
    isLoopback: isLoopbackHost(hostname),
  });
}
