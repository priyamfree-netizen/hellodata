import 'package:billsos_mobile/core/auth/token_store.dart';
import 'package:billsos_mobile/core/theme/oklch.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('oklch maps pure white and black correctly', () {
    expect(oklch(1, 0, 0), const Color(0xFFFFFFFF));
    expect(oklch(0, 0, 0), const Color(0xFF000000));
  });

  test('decodeJwt reads the payload claims', () {
    // header.{"sub":"u1","email":"a@b.co"}.sig  (payload base64url, unsigned)
    const payload = 'eyJzdWIiOiJ1MSIsImVtYWlsIjoiYUBiLmNvIn0';
    final claims = decodeJwt('h.$payload.s');
    expect(claims?['sub'], 'u1');
    expect(claims?['email'], 'a@b.co');
  });

  test('decodeJwt returns null on malformed token', () {
    expect(decodeJwt('not-a-jwt'), isNull);
    expect(decodeJwt(null), isNull);
  });
}
