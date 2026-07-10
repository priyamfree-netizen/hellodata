import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

/// Organizations, memberships, and the create-workspace RPCs.
class OrgRepository {
  OrgRepository(this._data);
  final SupabaseDataClient _data;

  /// Orgs the current user is an active member of.
  Future<List<Organization>> myOrganizations(String userId) async {
    final rows = await _data
        .from('organization_members')
        .select('organization:organizations(*)')
        .eq('user_id', userId)
        .eq('status', 'active');
    return (rows as List)
        .map((r) => (r as Map)['organization'])
        .whereType<Map<String, dynamic>>()
        .map(Organization.fromJson)
        .toList();
  }

  Future<Organization?> byId(String orgId) async {
    final row = await _data
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .maybeSingle();
    return row == null ? null : Organization.fromJson(row);
  }

  /// First workspace — SECURITY DEFINER RPC that also applies the free-plan grant.
  Future<void> createFirstOrganization(String name) async {
    final slug = _slugify(name);
    await _data.client.rpc('create_first_organization', params: {
      'p_name': name.trim(),
      'p_slug': slug.isEmpty ? 'org' : slug,
    });
  }

  /// Additional workspace (no free-plan re-grant).
  Future<void> createOrganization(String name) async {
    final slug = _slugify(name);
    await _data.client.rpc('create_organization', params: {
      'p_name': name.trim(),
      'p_slug': slug.isEmpty ? 'org' : slug,
    });
  }

  Future<List<OrganizationMember>> members(String orgId) async {
    final rows = await _data
        .from('organization_members')
        .select('*, profile:profiles!organization_members_user_id_fkey(*)')
        .eq('organization_id', orgId)
        .eq('status', 'active');
    return (rows as List)
        .map((r) => OrganizationMember.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  String _slugify(String name) {
    final s = name
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
        .replaceAll(RegExp(r'^-|-$'), '');
    return s.length > 48 ? s.substring(0, 48) : s;
  }
}
