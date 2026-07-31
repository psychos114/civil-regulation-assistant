import {
  initializeVectorStoreStep,
  vectorStoreStatusResponse,
} from "@/lib/vector-store";

export async function GET(): Promise<Response> {
  return vectorStoreStatusResponse();
}

export async function POST(): Promise<Response> {
  return initializeVectorStoreStep();
}
