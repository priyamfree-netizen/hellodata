import '../../../core/supabase/supabase_data_client.dart';
import '../../../shared/models/models.dart';

class TemplateRepository {
  TemplateRepository(this._data);
  final SupabaseDataClient _data;

  Future<List<DocumentCategory>> categories() async {
    final rows = await _data
        .from('document_categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
    return (rows as List)
        .map((r) => DocumentCategory.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  /// Templates visible to the org (public + org-owned), optionally by category.
  Future<List<Template>> templates({String? categoryId}) async {
    var query = _data.from('templates').select('*');
    if (categoryId != null) query = query.eq('category_id', categoryId);
    final rows = await query.order('is_featured', ascending: false).order('downloads',
        ascending: false);
    return (rows as List)
        .map((r) => Template.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<Template?> byId(String id) async {
    final row = await _data.from('templates').select('*').eq('id', id).maybeSingle();
    return row == null ? null : Template.fromJson(row);
  }

  Future<List<TemplateField>> fields(String templateId, {bool onlyEnabled = false}) async {
    var query = _data.from('template_fields').select('*').eq('template_id', templateId);
    if (onlyEnabled) query = query.eq('is_enabled', true);
    final rows = await query.order('sort_order');
    return (rows as List)
        .map((r) => TemplateField.fromJson(r as Map<String, dynamic>))
        .toList();
  }
}
