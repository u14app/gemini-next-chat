import { createRequestProofSessionResponse } from "@/lib/security/requestProof";

export async function GET() {
  return createRequestProofSessionResponse();
}
