import { handleFavoriteStateRequest } from '../../favorites/state.js';

export function onRequest(context) {
  return handleFavoriteStateRequest(context, { includeAuth: false });
}
