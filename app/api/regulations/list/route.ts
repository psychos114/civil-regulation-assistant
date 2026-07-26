import { internalError, listRegulations } from "@/lib/regulations";

export async function GET(request: Request): Promise<Response> {
  try {
    return await listRegulations(request);
  } catch (error) {
    return internalError(error);
  }
}
