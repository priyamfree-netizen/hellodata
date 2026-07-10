import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

class SupportRepository {
  SupportRepository(this._data);
  final SupabaseDataClient _data;

  Future<List<Ticket>> myTickets(String userId, {int limit = 30}) async {
    final rows = await _data
        .from('tickets')
        .select('*')
        .eq('requester_id', userId)
        .order('created_at', ascending: false)
        .limit(limit);
    return (rows as List).map((r) => Ticket.fromJson(r as Map<String, dynamic>)).toList();
  }

  Future<Ticket> createTicket({
    required String userId,
    String? orgId,
    required String subject,
    required String body,
    String priority = 'normal',
  }) async {
    final row = await _data
        .from('tickets')
        .insert({
          'requester_id': userId,
          'organization_id': orgId,
          'subject': subject,
          'body': body,
          'priority': priority,
          'status': 'open',
        })
        .select()
        .single();
    return Ticket.fromJson(row);
  }

  Future<List<TicketReply>> replies(String ticketId) async {
    final rows = await _data
        .from('ticket_replies')
        .select('*')
        .eq('ticket_id', ticketId)
        .eq('is_internal', false)
        .order('created_at');
    return (rows as List)
        .map((r) => TicketReply.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<void> addReply(String ticketId, String userId, String body) async {
    await _data.from('ticket_replies').insert({
      'ticket_id': ticketId,
      'author_id': userId,
      'body': body,
      'is_internal': false,
    });
  }
}
