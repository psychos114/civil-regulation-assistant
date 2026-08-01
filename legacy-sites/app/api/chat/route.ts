import { chatInternalError, chatWithModel } from "@/lib/chat";

export async function POST(request: Request): Promise<Response> {
  try {
    return await chatWithModel(request);
  } catch (error) {
    return chatInternalError(error);
  }
}
