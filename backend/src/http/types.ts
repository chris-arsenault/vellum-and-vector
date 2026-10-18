export interface AlbEvent {
  httpMethod: string;
  path: string;
  headers?: Record<string, string | undefined>;
  multiValueHeaders?: Record<string, string[] | undefined>;
  queryStringParameters?: Record<string, string | undefined> | null;
  multiValueQueryStringParameters?: Record<string, string[] | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { elb?: { targetGroupArn: string } };
}
export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  requestId: string;
}
export interface Principal {
  owner: string;
  clientId: string;
}
export interface RequestContext {
  principal: Principal;
  actor: string;
  requestId: string;
}
export interface HttpResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}
export interface AlbResult {
  statusCode: number;
  statusDescription: string;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: false;
}
export interface HttpConfig {
  clientId: string;
  origin: string;
}
