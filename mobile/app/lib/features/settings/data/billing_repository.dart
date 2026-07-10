import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

class BillingRepository {
  BillingRepository(this._data);
  final SupabaseDataClient _data;

  Future<Subscription?> activeSubscription(String orgId) async {
    final row = await _data
        .from('subscriptions')
        .select('*, plan:plans(*)')
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .order('created_at', ascending: false)
        .limit(1)
        .maybeSingle();
    return row == null ? null : Subscription.fromJson(row);
  }

  Future<List<Map<String, dynamic>>> invoices(String orgId, {int limit = 12}) async {
    final rows = await _data
        .from('invoices')
        .select('id, number, amount_inr, status, issue_date')
        .eq('organization_id', orgId)
        .order('issue_date', ascending: false)
        .limit(limit);
    return (rows as List).cast<Map<String, dynamic>>();
  }

  Future<List<Map<String, dynamic>>> transactions(String orgId, {int limit = 20}) async {
    final rows = await _data
        .from('transactions')
        .select('id, amount_inr, status, method, created_at')
        .eq('organization_id', orgId)
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List).cast<Map<String, dynamic>>();
  }
}
