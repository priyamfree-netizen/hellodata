import 'dart:typed_data';

import 'package:supabase/supabase.dart' show FileOptions;

import '../../../core/network/api_client.dart';
import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

class DocumentRepository {
  DocumentRepository(this._data, this._api);
  final SupabaseDataClient _data;
  final ApiClient _api;

  Future<List<DocumentRow>> list(String orgId, {int limit = 50}) async {
    final rows = await _data
        .from('documents')
        .select('*, category:document_categories(*)')
        .eq('organization_id', orgId)
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List)
        .map((r) => DocumentRow.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  /// Uploads bytes to the `documents` bucket, then inserts a `documents` row.
  /// On DB-insert failure the uploaded object is removed (orphan cleanup),
  /// mirroring the web `useUploadDocument`.
  Future<DocumentRow> upload({
    required String orgId,
    required Uint8List bytes,
    required String fileName,
    required String mimeType,
    String? categoryId,
    String? templateId,
  }) async {
    final path = '$orgId/${DateTime.now().millisecondsSinceEpoch}-$fileName';

    await _data.storage.from('documents').uploadBinary(
          path,
          bytes,
          fileOptions: FileOptions(contentType: mimeType, upsert: true),
        );

    try {
      final row = await _data
          .from('documents')
          .insert({
            'organization_id': orgId,
            'file_name': fileName,
            'storage_path': path,
            'mime_type': mimeType,
            'file_size_bytes': bytes.length,
            'category_id': categoryId,
            'template_id': templateId,
            'status': 'uploaded',
            'source': 'mobile',
          })
          .select()
          .single();
      return DocumentRow.fromJson(row);
    } catch (e) {
      try {
        await _data.storage.from('documents').remove([path]);
      } catch (_) {
        // best-effort orphan cleanup
      }
      rethrow;
    }
  }

  /// Signed URL for preview/download (1 hour), via the direct storage API.
  Future<String?> signedUrl(String storagePath) async {
    try {
      return await _data.storage.from('documents').createSignedUrl(storagePath, 3600);
    } catch (_) {
      return null;
    }
  }

  /// Alternative: ask the Worker for a signed URL (respects membership checks).
  Future<String?> signedUrlViaApi(String documentId) async {
    final res = await _api.getJson('/api/documents/$documentId/signed-url');
    final url = res['signedUrl'];
    return url is String ? url : null;
  }
}
