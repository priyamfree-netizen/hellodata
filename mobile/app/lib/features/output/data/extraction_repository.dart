import '../../../core/network/api_client.dart';
import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

/// Extraction results + the extraction trigger (Worker `/api/extract/document`).
class ExtractionRepository {
  ExtractionRepository(this._data, this._api);
  final SupabaseDataClient _data;
  final ApiClient _api;

  Future<List<Extraction>> list(String orgId, {int limit = 50}) async {
    final rows = await _data
        .from('extractions')
        .select('*, document:documents(*, category:document_categories(*))')
        .eq('organization_id', orgId)
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List)
        .map((r) => Extraction.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<Extraction?> byId(String id) async {
    final row = await _data
        .from('extractions')
        .select('*, document:documents(*, category:document_categories(*))')
        .eq('id', id)
        .maybeSingle();
    return row == null ? null : Extraction.fromJson(row);
  }

  Future<Extraction?> byJobId(String jobId) async {
    final row = await _data
        .from('extractions')
        .select('*, document:documents(*, category:document_categories(*))')
        .eq('job_id', jobId)
        .order('created_at', ascending: false)
        .limit(1)
        .maybeSingle();
    return row == null ? null : Extraction.fromJson(row);
  }

  /// Kicks off extraction. Returns the `{job_id, extraction_id, status, data}`
  /// payload. The pipeline runs server-side and can take tens of seconds; the
  /// UI should navigate to the Processing screen rather than block on this.
  Future<Map<String, dynamic>> extract({
    required String documentId,
    String? templateId,
    String? documentType,
  }) async {
    return _api.postJson('/api/extract/document', body: {
      'document_id': documentId,
      'template_id': ?templateId,
      'document_type': ?documentType,
    });
  }

  Future<void> updateData(
    String orgId,
    String extractionId,
    Map<String, dynamic> data,
  ) async {
    await _data
        .from('extractions')
        .update({'data': data})
        .eq('organization_id', orgId)
        .eq('id', extractionId);
  }

  Future<void> delete(String orgId, List<String> ids) async {
    if (ids.isEmpty) return;
    await _data.from('extractions').delete().eq('organization_id', orgId).inFilter('id', ids);
  }
}
