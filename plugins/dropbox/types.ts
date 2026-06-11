export interface SignalingPeer {
  id: string;
  name: string;
}

export interface SdpPayload {
  type: string;
  sdp: string;
}

export interface SignalingMessage {
  type: string;
  id?: string;
  name?: string;
  from?: string;
  target?: string;
  peers?: SignalingPeer[] | number;
  total?: number;
  sdp?: SdpPayload;
  candidate?: RTCIceCandidateJSON;
}

export interface RTCIceCandidateJSON {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface WsData {
  id: string;
}

export function generatePeerName(prefix: string): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const hash = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${hh}${mm}-${hash}`;
}
