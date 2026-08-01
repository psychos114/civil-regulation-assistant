import {
  initializeVectorStoreStep,
  vectorStoreStatusResponse,
} from "@/lib/vector-store";

export async function GET(): Promise<Response> {
  return vectorStoreStatusResponse();
}

export async function POST(): Promise<Response> {
  let response = await initializeVectorStoreStep();

  // A deployment browser can close shortly after the page becomes visible.
  // Finish the small, idempotent import in this one keepalive request so the
  // remote vector store is not left half initialized.
  for (let attempt = 1; attempt < 24; attempt += 1) {
    const payload = (await response.clone().json().catch(() => null)) as
      | { data?: { ready?: boolean } }
      | null;
    if (response.status >= 400 || payload?.data?.ready) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
    response = await initializeVectorStoreStep();
  }

  return response;
}
