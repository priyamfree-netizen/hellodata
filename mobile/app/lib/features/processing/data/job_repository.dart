import 'dart:async';

import 'package:supabase/supabase.dart';

import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

class JobRepository {
  JobRepository(this._data);
  final SupabaseDataClient _data;

  Future<List<ProcessingJob>> list(String orgId, {int limit = 50}) async {
    final rows = await _data
        .from('processing_jobs')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List)
        .map((r) => ProcessingJob.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<ProcessingJob?> byId(String jobId) async {
    final row =
        await _data.from('processing_jobs').select('*').eq('id', jobId).maybeSingle();
    return row == null ? null : ProcessingJob.fromJson(row);
  }

  /// Live updates for a single job via Realtime Postgres changes.
  /// Falls back to nothing if realtime isn't reachable — callers should also
  /// poll [byId] as a safety net.
  Stream<ProcessingJob> watch(String jobId) {
    final controller = StreamController<ProcessingJob>();
    final channel = _data.channel('job:$jobId');

    channel
        .onPostgresChanges(
          event: PostgresChangeEvent.update,
          schema: 'public',
          table: 'processing_jobs',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'id',
            value: jobId,
          ),
          callback: (payload) {
            final rec = payload.newRecord;
            controller.add(ProcessingJob.fromJson(rec));
          },
        )
        .subscribe();

    controller.onCancel = () => _data.client.removeChannel(channel);
    return controller.stream;
  }
}
