import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

class DashboardKpis {
  DashboardKpis({
    required this.documents,
    required this.extractions,
    required this.processing,
    required this.creditsRemaining,
    required this.org,
  });

  final int documents;
  final int extractions;
  final int processing;
  final int creditsRemaining;
  final Organization? org;
}

/// Computes user-facing KPIs directly from the org's own data. (The web
/// `/api/admin/dashboard-kpis` endpoint is super-admin only, so we don't use it.)
class DashboardRepository {
  DashboardRepository(this._data);
  final SupabaseDataClient _data;

  Future<DashboardKpis> load(String orgId, int creditsRemaining) async {
    final docsRows = await _data.from('documents').select('id').eq('organization_id', orgId);
    final extRows = await _data.from('extractions').select('id, status').eq('organization_id', orgId);
    final orgRow =
        await _data.from('organizations').select('*').eq('id', orgId).maybeSingle();

    final processing = (extRows as List)
        .where((r) => (r as Map)['status'] == 'processing' || r['status'] == 'queued')
        .length;

    return DashboardKpis(
      documents: (docsRows as List).length,
      extractions: extRows.length,
      processing: processing,
      creditsRemaining: creditsRemaining,
      org: orgRow == null ? null : Organization.fromJson(orgRow),
    );
  }
}
