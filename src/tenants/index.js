import { TenantList } from "./TenantList";
import { TenantShow } from "./TenantShow";
import { TenantEdit } from "./TenantEdit";
import { TenantCreate } from "./TenantCreate";
import ApartmentIcon from '@mui/icons-material/Apartment';

const tenants = {
  list: TenantList,
  show: TenantShow,
  edit: TenantEdit,
  create: TenantCreate,
  icon: ApartmentIcon,
  recordRepresentation: "name",
};

export default tenants;