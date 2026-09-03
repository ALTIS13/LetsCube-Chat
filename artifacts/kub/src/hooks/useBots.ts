import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { botManagement, type BotCommand } from "@/lib/botManagement";
import { clearBotAvatar, uploadBotAvatar } from "@/lib/botAvatar";

const listKey = ["bot-management", "list"] as const;
const detailKey = (botId: string) => ["bot-management", "detail", botId] as const;

export function useBots() {
  return useQuery({ queryKey: listKey, queryFn: botManagement.list, retry: false });
}

export function useBotDetail(botId: string | null) {
  return useQuery({
    queryKey: detailKey(botId ?? "none"),
    queryFn: () => botManagement.detail(botId!),
    enabled: Boolean(botId),
    retry: false,
  });
}

export function useBotMutations(botId: string) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listKey }),
      queryClient.invalidateQueries({ queryKey: detailKey(botId) }),
    ]);
  };
  return {
    pause: useMutation({ mutationFn: () => botManagement.pause(botId), onSuccess: refresh, retry: false }),
    resume: useMutation({ mutationFn: () => botManagement.resume(botId), onSuccess: refresh, retry: false }),
    revoke: useMutation({ mutationFn: () => botManagement.revokeToken(botId), onSuccess: refresh, retry: false }),
    requestDeletion: useMutation({ mutationFn: () => botManagement.requestDeletion(botId), onSuccess: refresh, retry: false }),
    cancelDeletion: useMutation({ mutationFn: () => botManagement.cancelDeletion(botId), onSuccess: refresh, retry: false }),
    profile: useMutation({
      mutationFn: (input: { display_name: string; description: string }) => botManagement.updateProfile(botId, input),
      onSuccess: refresh,
      retry: false,
    }),
    avatar: useMutation({
      // `null` removes the picture; a file uploads and records one.
      mutationFn: async (file: File | null) => {
        if (file) await uploadBotAvatar(botId, file);
        else await clearBotAvatar(botId);
      },
      onSuccess: refresh,
      retry: false,
    }),
    commands: useMutation({
      mutationFn: (commands: BotCommand[]) => botManagement.updateCommands(botId, commands),
      onSuccess: refresh,
      retry: false,
    }),
    addDeveloper: useMutation({
      mutationFn: (username: string) => botManagement.addDeveloper(botId, username),
      onSuccess: refresh,
      retry: false,
    }),
    removeDeveloper: useMutation({
      mutationFn: (developerId: string) => botManagement.removeDeveloper(botId, developerId),
      onSuccess: refresh,
      retry: false,
    }),
    refresh,
  };
}
