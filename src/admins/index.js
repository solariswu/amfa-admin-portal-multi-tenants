import { AdminList } from "./AdminList";
import { AdminEdit } from "./AdminEdit";
import { AdminCreate } from "./AdminCreate";
import UserIcon from '@mui/icons-material/People';

const admins ={
  list: AdminList,
  edit: AdminEdit,
  create: AdminCreate,
  hasCreate: true,
  icon: UserIcon,
  recordRepresentation: "model",
};

export default admins;