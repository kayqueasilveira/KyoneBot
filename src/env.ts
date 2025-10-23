import { validateEnv } from '#base';
import { z } from 'zod';

export const env = validateEnv(
  z.object({
    BOT_TOKEN: z.string('Discord Bot Token is required').min(1),
    WEBHOOK_LOGS_URL: z.url().optional(),
    GUILD_ID: z.string().optional(),

    SUPABASE_URL: z
      .string()
      .url({ message: 'SUPABASE_URL é obrigatória e deve ser uma URL válida' }),
    SUPABASE_KEY: z
      .string({ message: 'SUPABASE_KEY (anon ou service_role) é obrigatória' })
      .min(1),
  })
);
