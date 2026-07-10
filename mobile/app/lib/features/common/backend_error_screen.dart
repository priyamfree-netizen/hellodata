import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';

/// Shown when membership resolution errored. Offers a retry — we never guess
/// that a backend error means "no workspace" (that caused loops on web).
class BackendErrorScreen extends ConsumerWidget {
  const BackendErrorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final message = ref.watch(sessionControllerProvider).errorMessage;
    final colors = context.colors;
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.cloud_off_rounded, size: 56, color: colors.mutedForeground),
              const SizedBox(height: 20),
              Text(
                "We couldn't reach the server",
                style: Theme.of(context).textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                message ?? 'Please check your connection and try again.',
                style: TextStyle(color: colors.mutedForeground),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () =>
                      ref.read(sessionControllerProvider.notifier).bootstrap(),
                  child: const Text('Retry'),
                ),
              ),
              TextButton(
                onPressed: () =>
                    ref.read(sessionControllerProvider.notifier).logout(),
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
