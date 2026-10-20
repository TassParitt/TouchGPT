import { handleApi } from "../../cloudflare/api.js";
export function onRequest(context) {
  return handleApi(context.request, context.env, context);
}
