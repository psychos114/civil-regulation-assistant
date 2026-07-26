import { checkUpdate, internalError } from "@/lib/regulations";

export async function GET(): Promise<Response> {
  try {
    return await checkUpdate();
  } catch (error) {
    return internalError(error);
  }
}
