import type { GameRoom } from "./room";

export interface Env {
  ASSETS: Fetcher;
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  ADMIN_PIN: string;
}
