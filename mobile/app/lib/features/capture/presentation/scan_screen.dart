import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';

/// Phase 4 — capture a document (camera / gallery / PDF), upload it, then move
/// to Configure. Camera + gallery use image_picker; PDFs use file_picker.
/// (Edge-detection auto-crop scanner is a planned enhancement.)
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _fromCamera() => _pickImage(ImageSource.camera);
  Future<void> _fromGallery() => _pickImage(ImageSource.gallery);

  Future<void> _pickImage(ImageSource source) async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: source, imageQuality: 85, maxWidth: 2400);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final mime = file.mimeType ?? _mimeFromName(file.name);
    await _upload(bytes, file.name, mime);
  }

  Future<void> _pickPdf() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf'],
      withData: true,
    );
    final picked = result?.files.singleOrNull;
    if (picked == null || picked.bytes == null) return;
    await _upload(picked.bytes!, picked.name, 'application/pdf');
  }

  Future<void> _upload(Uint8List bytes, String fileName, String mime) async {
    final orgId = ref.read(activeOrgIdProvider);
    if (orgId == null) {
      setState(() => _error = 'No workspace selected');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final doc = await ref.read(documentRepositoryProvider).upload(
            orgId: orgId,
            bytes: bytes,
            fileName: fileName,
            mimeType: mime,
          );
      if (mounted) context.pushReplacement('/configure/${doc.id}');
    } catch (e) {
      setState(() => _error = 'Upload failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _mimeFromName(String name) {
    final n = name.toLowerCase();
    if (n.endsWith('.png')) return 'image/png';
    if (n.endsWith('.pdf')) return 'application/pdf';
    return 'image/jpeg';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Scaffold(
      appBar: AppBar(title: const Text('Capture document')),
      body: _busy
          ? const Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Uploading…'),
                ],
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(_error!, style: TextStyle(color: colors.destructive)),
                  ),
                _OptionCard(
                  icon: Icons.camera_alt_outlined,
                  title: 'Take a photo',
                  subtitle: 'Capture an invoice or receipt with the camera',
                  onTap: _fromCamera,
                ),
                _OptionCard(
                  icon: Icons.photo_library_outlined,
                  title: 'Choose from gallery',
                  subtitle: 'Pick an existing image',
                  onTap: _fromGallery,
                ),
                _OptionCard(
                  icon: Icons.picture_as_pdf_outlined,
                  title: 'Upload a PDF',
                  subtitle: 'Select a PDF document',
                  onTap: _pickPdf,
                ),
              ],
            ),
    );
  }
}

class _OptionCard extends StatelessWidget {
  const _OptionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: CircleAvatar(
          radius: 24,
          backgroundColor: colors.brandBlue.withValues(alpha: 0.12),
          child: Icon(icon, color: colors.brandBlue),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
