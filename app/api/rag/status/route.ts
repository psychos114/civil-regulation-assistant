import { ragStatus } from "@/lib/rag";

export async function GET(): Promise<Response> {
  return ragStatus();
}
