import { dispatch } from '../../server/email/dispatch.js';

export default function handler(req, res) {
  return dispatch(req, res);
}
