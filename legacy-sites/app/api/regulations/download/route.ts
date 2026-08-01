import { downloadRegulations, internalError } from "@/lib/regulations";

export async function POST(request: Request): Promise<Response> {
  try {
    return await downloadRegulations(request);
  } catch (error) {
    return internalError(error);
  }
}
