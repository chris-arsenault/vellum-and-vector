import type {
  MapCall,
  LibraryCall,
  NavigationCall,
  GenerationCall,
  ContextCall,
} from "@atlas/transport";
export type AtlasCall =
  | { service: "maps"; call: MapCall }
  | { service: "library"; call: LibraryCall }
  | { service: "navigation"; call: NavigationCall }
  | { service: "generation"; call: GenerationCall }
  | { service: "contexts"; call: ContextCall }
  | { service: "open" | "close" };
export interface AtlasRequest {
  id: number;
  operation: AtlasCall;
}
export type AtlasReply = { id: number; value: unknown } | { id: number; error: string };
