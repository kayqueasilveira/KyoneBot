import { env } from '#env';
import { logger } from '#functions';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

logger.system('Supabase', 'Cliente inicializado.');
