import { getRegulation, internalError } from "@/lib/regulations";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    return await getRegulation(id);
  } catch (error) {
    return internalError(error);
  }
}
