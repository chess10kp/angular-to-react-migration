import dayjs from 'dayjs/esm';

export interface ICampaign {
  id: number;
  name: string;
  slug: string;
  budget: number;
  active: boolean;
  tenantId: string;
  startDate?: dayjs.Dayjs | null;
}

export type NewCampaign = Omit<ICampaign, 'id'> & { id: null };
