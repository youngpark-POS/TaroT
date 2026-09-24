// CloudFront Functions invokes this global entry point.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/') || uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
    request.uri = '/index.html';
  }
  return request;
}
