/// Domain models mirroring the BillSOS Supabase schema
/// (supabase/migrations/00000000000000_schema.sql). Only the user-side columns
/// the mobile app actually reads/writes are modelled.
library;

// ── helpers ──────────────────────────────────────────────────────────────────
int _asInt(dynamic v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('$v') ?? 0);
double? _asDoubleOrNull(dynamic v) =>
    v == null ? null : (v is num ? v.toDouble() : double.tryParse('$v'));
DateTime? _asDate(dynamic v) => v == null ? null : DateTime.tryParse('$v');
String? _str(dynamic v) => v?.toString();

// ── Profile ──────────────────────────────────────────────────────────────────
class Profile {
  Profile({
    required this.id,
    required this.email,
    this.firstName,
    this.lastName,
    this.fullName,
    this.phone,
    this.avatarUrl,
    this.country,
    this.currentOrgId,
    this.status = 'active',
    this.isSuperAdmin = false,
    this.twoFactorEnabled = false,
    this.creditsRemaining = 0,
    this.lastLoginAt,
  });

  final String id;
  final String email;
  final String? firstName;
  final String? lastName;
  final String? fullName;
  final String? phone;
  final String? avatarUrl;
  final String? country;
  final String? currentOrgId;
  final String status;
  final bool isSuperAdmin;
  final bool twoFactorEnabled;
  final int creditsRemaining;
  final DateTime? lastLoginAt;

  String get displayName {
    final n = (fullName ?? '').trim();
    if (n.isNotEmpty) return n;
    return email.split('@').first;
  }

  String get initials {
    final n = displayName.trim();
    final parts = n.split(RegExp(r'\s+'));
    if (parts.length >= 2) return (parts.first[0] + parts.last[0]).toUpperCase();
    return n.isNotEmpty ? n.substring(0, 1).toUpperCase() : '?';
  }

  factory Profile.fromJson(Map<String, dynamic> j) => Profile(
        id: j['id'].toString(),
        email: j['email'].toString(),
        firstName: _str(j['first_name']),
        lastName: _str(j['last_name']),
        fullName: _str(j['full_name']),
        phone: _str(j['phone']),
        avatarUrl: _str(j['avatar_url']),
        country: _str(j['country']),
        currentOrgId: _str(j['current_org_id']),
        status: (j['status'] ?? 'active').toString(),
        isSuperAdmin: j['is_super_admin'] == true,
        twoFactorEnabled: j['two_factor_enabled'] == true,
        creditsRemaining: _asInt(j['credits_remaining']),
        lastLoginAt: _asDate(j['last_login_at']),
      );
}

// ── Organization ───────────────────────────────────────────────────────────
class Organization {
  Organization({
    required this.id,
    required this.name,
    required this.slug,
    this.status = 'trial',
    this.planId,
    this.storageLimitBytes = 0,
    this.storageUsedBytes = 0,
    this.pagesProcessed = 0,
    this.teamSize = 1,
  });

  final String id;
  final String name;
  final String slug;
  final String status;
  final String? planId;
  final int storageLimitBytes;
  final int storageUsedBytes;
  final int pagesProcessed;
  final int teamSize;

  double get storageFraction =>
      storageLimitBytes <= 0 ? 0 : (storageUsedBytes / storageLimitBytes).clamp(0, 1);

  factory Organization.fromJson(Map<String, dynamic> j) => Organization(
        id: j['id'].toString(),
        name: (j['name'] ?? '').toString(),
        slug: (j['slug'] ?? '').toString(),
        status: (j['status'] ?? 'trial').toString(),
        planId: _str(j['plan_id']),
        storageLimitBytes: _asInt(j['storage_limit_bytes']),
        storageUsedBytes: _asInt(j['storage_used_bytes']),
        pagesProcessed: _asInt(j['pages_processed']),
        teamSize: _asInt(j['team_size']),
      );
}

class OrganizationMember {
  OrganizationMember({
    required this.id,
    required this.organizationId,
    required this.userId,
    this.role = 'member',
    this.status = 'active',
    this.profile,
  });

  final String id;
  final String organizationId;
  final String userId;
  final String role;
  final String status;
  final Profile? profile;

  factory OrganizationMember.fromJson(Map<String, dynamic> j) => OrganizationMember(
        id: j['id'].toString(),
        organizationId: j['organization_id'].toString(),
        userId: j['user_id'].toString(),
        role: (j['role'] ?? 'member').toString(),
        status: (j['status'] ?? 'active').toString(),
        profile: j['profile'] is Map<String, dynamic>
            ? Profile.fromJson(j['profile'] as Map<String, dynamic>)
            : null,
      );
}

// ── Document category ────────────────────────────────────────────────────────
class DocumentCategory {
  DocumentCategory({
    required this.id,
    required this.code,
    required this.name,
    this.description,
    this.tag = 'core',
    this.icon,
    this.defaultFields = 0,
    this.isActive = true,
  });

  final String id;
  final String code;
  final String name;
  final String? description;
  final String tag;
  final String? icon;
  final int defaultFields;
  final bool isActive;

  factory DocumentCategory.fromJson(Map<String, dynamic> j) => DocumentCategory(
        id: j['id'].toString(),
        code: (j['code'] ?? '').toString(),
        name: (j['name'] ?? '').toString(),
        description: _str(j['description']),
        tag: (j['tag'] ?? 'core').toString(),
        icon: _str(j['icon']),
        defaultFields: _asInt(j['default_fields']),
        isActive: j['is_active'] != false,
      );
}

// ── Template + fields ────────────────────────────────────────────────────────
class Template {
  Template({
    required this.id,
    required this.name,
    this.description,
    this.categoryId,
    this.organizationId,
    this.scope = 'org',
    this.status = 'draft',
    this.fieldCount = 0,
    this.downloads = 0,
    this.rating = 0,
    this.isFeatured = false,
  });

  final String id;
  final String name;
  final String? description;
  final String? categoryId;
  final String? organizationId;
  final String scope;
  final String status;
  final int fieldCount;
  final int downloads;
  final double rating;
  final bool isFeatured;

  bool get isPublic => scope == 'public';

  factory Template.fromJson(Map<String, dynamic> j) => Template(
        id: j['id'].toString(),
        name: (j['name'] ?? '').toString(),
        description: _str(j['description']),
        categoryId: _str(j['category_id']),
        organizationId: _str(j['organization_id']),
        scope: (j['scope'] ?? 'org').toString(),
        status: (j['status'] ?? 'draft').toString(),
        fieldCount: _asInt(j['field_count']),
        downloads: _asInt(j['downloads']),
        rating: _asDoubleOrNull(j['rating']) ?? 0,
        isFeatured: j['is_featured'] == true,
      );
}

class TemplateField {
  TemplateField({
    required this.id,
    required this.templateId,
    required this.key,
    required this.label,
    this.fieldGroup = 'General',
    this.dataType = 'string',
    this.isRequired = false,
    this.isEnabled = true,
    this.sortOrder = 0,
  });

  final String id;
  final String templateId;
  final String key;
  final String label;
  final String fieldGroup;
  final String dataType;
  final bool isRequired;
  final bool isEnabled;
  final int sortOrder;

  factory TemplateField.fromJson(Map<String, dynamic> j) => TemplateField(
        id: j['id'].toString(),
        templateId: j['template_id'].toString(),
        key: (j['key'] ?? '').toString(),
        label: (j['label'] ?? '').toString(),
        fieldGroup: (j['field_group'] ?? 'General').toString(),
        dataType: (j['data_type'] ?? 'string').toString(),
        isRequired: j['is_required'] == true,
        isEnabled: j['is_enabled'] != false,
        sortOrder: _asInt(j['sort_order']),
      );
}

// ── Document ─────────────────────────────────────────────────────────────────
class DocumentRow {
  DocumentRow({
    required this.id,
    required this.organizationId,
    required this.fileName,
    this.storagePath,
    this.mimeType,
    this.fileSizeBytes = 0,
    this.pageCount = 0,
    this.status = 'uploaded',
    this.categoryId,
    this.templateId,
    this.createdAt,
    this.category,
  });

  final String id;
  final String organizationId;
  final String fileName;
  final String? storagePath;
  final String? mimeType;
  final int fileSizeBytes;
  final int pageCount;
  final String status;
  final String? categoryId;
  final String? templateId;
  final DateTime? createdAt;
  final DocumentCategory? category;

  factory DocumentRow.fromJson(Map<String, dynamic> j) => DocumentRow(
        id: j['id'].toString(),
        organizationId: j['organization_id'].toString(),
        fileName: (j['file_name'] ?? 'document').toString(),
        storagePath: _str(j['storage_path']),
        mimeType: _str(j['mime_type']),
        fileSizeBytes: _asInt(j['file_size_bytes']),
        pageCount: _asInt(j['page_count']),
        status: (j['status'] ?? 'uploaded').toString(),
        categoryId: _str(j['category_id']),
        templateId: _str(j['template_id']),
        createdAt: _asDate(j['created_at']),
        category: j['category'] is Map<String, dynamic>
            ? DocumentCategory.fromJson(j['category'] as Map<String, dynamic>)
            : null,
      );
}

// ── Processing job ───────────────────────────────────────────────────────────
class ProcessingJob {
  ProcessingJob({
    required this.id,
    required this.organizationId,
    this.documentId,
    this.name = '',
    this.stage = 'pending',
    this.confidence,
    this.errorMessage,
    this.totalDocs = 1,
    this.completedDocs = 0,
    this.failedDocs = 0,
    this.durationMs,
    this.createdAt,
  });

  final String id;
  final String organizationId;
  final String? documentId;
  final String name;
  final String stage;
  final double? confidence;
  final String? errorMessage;
  final int totalDocs;
  final int completedDocs;
  final int failedDocs;
  final int? durationMs;
  final DateTime? createdAt;

  bool get isTerminal => stage == 'completed' || stage == 'failed' || stage == 'dead_letter';
  bool get isFailed => stage == 'failed' || stage == 'dead_letter';

  factory ProcessingJob.fromJson(Map<String, dynamic> j) => ProcessingJob(
        id: j['id'].toString(),
        organizationId: j['organization_id'].toString(),
        documentId: _str(j['document_id']),
        name: (j['name'] ?? '').toString(),
        stage: (j['stage'] ?? 'pending').toString(),
        confidence: _asDoubleOrNull(j['confidence']),
        errorMessage: _str(j['error_message']),
        totalDocs: _asInt(j['total_docs']),
        completedDocs: _asInt(j['completed_docs']),
        failedDocs: _asInt(j['failed_docs']),
        durationMs: j['duration_ms'] == null ? null : _asInt(j['duration_ms']),
        createdAt: _asDate(j['created_at']),
      );
}

// ── Extraction ───────────────────────────────────────────────────────────────
class Extraction {
  Extraction({
    required this.id,
    required this.organizationId,
    required this.documentId,
    this.jobId,
    this.templateId,
    this.status = 'queued',
    this.confidence,
    this.fieldCount = 0,
    this.data = const {},
    this.errorMessage,
    this.createdAt,
    this.document,
  });

  final String id;
  final String organizationId;
  final String documentId;
  final String? jobId;
  final String? templateId;
  final String status;
  final double? confidence;
  final int fieldCount;
  final Map<String, dynamic> data;
  final String? errorMessage;
  final DateTime? createdAt;
  final DocumentRow? document;

  factory Extraction.fromJson(Map<String, dynamic> j) => Extraction(
        id: j['id'].toString(),
        organizationId: j['organization_id'].toString(),
        documentId: j['document_id'].toString(),
        jobId: _str(j['job_id']),
        templateId: _str(j['template_id']),
        status: (j['status'] ?? 'queued').toString(),
        confidence: _asDoubleOrNull(j['confidence']),
        fieldCount: _asInt(j['field_count']),
        data: j['data'] is Map<String, dynamic>
            ? (j['data'] as Map<String, dynamic>)
            : <String, dynamic>{},
        errorMessage: _str(j['error_message']),
        createdAt: _asDate(j['created_at']),
        document: j['document'] is Map<String, dynamic>
            ? DocumentRow.fromJson(j['document'] as Map<String, dynamic>)
            : null,
      );
}

// ── Plan + subscription ──────────────────────────────────────────────────────
class Plan {
  Plan({required this.id, required this.name, this.code, this.priceInr, this.interval = 'monthly'});
  final String id;
  final String name;
  final String? code;
  final double? priceInr;
  final String interval;

  factory Plan.fromJson(Map<String, dynamic> j) => Plan(
        id: j['id'].toString(),
        name: (j['name'] ?? '').toString(),
        code: _str(j['code']),
        priceInr: _asDoubleOrNull(j['price_amount_inr']),
        interval: (j['interval'] ?? 'monthly').toString(),
      );
}

class Subscription {
  Subscription({
    required this.id,
    required this.organizationId,
    this.status = 'active',
    this.currentPeriodEnd,
    this.plan,
  });
  final String id;
  final String organizationId;
  final String status;
  final DateTime? currentPeriodEnd;
  final Plan? plan;

  factory Subscription.fromJson(Map<String, dynamic> j) => Subscription(
        id: j['id'].toString(),
        organizationId: j['organization_id'].toString(),
        status: (j['status'] ?? 'active').toString(),
        currentPeriodEnd: _asDate(j['current_period_end']),
        plan: j['plan'] is Map<String, dynamic>
            ? Plan.fromJson(j['plan'] as Map<String, dynamic>)
            : null,
      );
}

// ── Notification ─────────────────────────────────────────────────────────────
class UserNotification {
  UserNotification({
    required this.id,
    required this.title,
    this.body,
    this.link,
    this.isRead = false,
    this.createdAt,
  });
  final String id;
  final String title;
  final String? body;
  final String? link;
  final bool isRead;
  final DateTime? createdAt;

  factory UserNotification.fromJson(Map<String, dynamic> j) => UserNotification(
        id: j['id'].toString(),
        title: (j['title'] ?? '').toString(),
        body: _str(j['body']),
        link: _str(j['link']),
        isRead: j['is_read'] == true,
        createdAt: _asDate(j['created_at']),
      );
}

// ── Support ticket ───────────────────────────────────────────────────────────
class Ticket {
  Ticket({
    required this.id,
    required this.subject,
    this.body,
    this.status = 'open',
    this.priority = 'normal',
    this.createdAt,
  });
  final String id;
  final String subject;
  final String? body;
  final String status;
  final String priority;
  final DateTime? createdAt;

  factory Ticket.fromJson(Map<String, dynamic> j) => Ticket(
        id: j['id'].toString(),
        subject: (j['subject'] ?? '').toString(),
        body: _str(j['body']),
        status: (j['status'] ?? 'open').toString(),
        priority: (j['priority'] ?? 'normal').toString(),
        createdAt: _asDate(j['created_at']),
      );
}

class TicketReply {
  TicketReply({required this.id, required this.body, this.authorId, this.createdAt});
  final String id;
  final String body;
  final String? authorId;
  final DateTime? createdAt;

  factory TicketReply.fromJson(Map<String, dynamic> j) => TicketReply(
        id: j['id'].toString(),
        body: (j['body'] ?? '').toString(),
        authorId: _str(j['author_id']),
        createdAt: _asDate(j['created_at']),
      );
}

// ── Active session ───────────────────────────────────────────────────────────
class UserSession {
  UserSession({
    required this.id,
    this.device,
    this.location,
    this.lastSeenAt,
    this.revokedAt,
  });
  final String id;
  final String? device;
  final String? location;
  final DateTime? lastSeenAt;
  final DateTime? revokedAt;

  bool get isActive => revokedAt == null;

  factory UserSession.fromJson(Map<String, dynamic> j) => UserSession(
        id: j['id'].toString(),
        device: _str(j['device']),
        location: _str(j['location']),
        lastSeenAt: _asDate(j['last_seen_at']),
        revokedAt: _asDate(j['revoked_at']),
      );
}
