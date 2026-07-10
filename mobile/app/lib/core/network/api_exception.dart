/// Typed error surface for the whole app. Repositories translate transport
/// failures into these so UI can respond consistently.
enum ApiErrorKind {
  network,
  unauthorized,
  forbidden,
  notFound,
  rateLimited,
  server,
  unknown,
}

class ApiException implements Exception {
  ApiException(this.kind, this.message, {this.statusCode});

  final ApiErrorKind kind;
  final String message;
  final int? statusCode;

  bool get isUnauthorized => kind == ApiErrorKind.unauthorized;

  @override
  String toString() => 'ApiException($kind, $statusCode): $message';
}
