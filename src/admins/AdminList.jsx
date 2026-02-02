

import {
  List,
  Datagrid,
  ArrayField,
  SingleFieldList,
  FunctionField,
  TextField,
  useRedirect,
  TextInput,
  CreateButton,
  TopToolbar,
  FilterButton,
  useGetList,
  SelectInput,
  usePermissions,
} from "react-admin";
import { InputAdornment, IconButton } from "@mui/material";
import { Search } from "@mui/icons-material";
import UserListMenu from "./AdminListMenu";
import { RoleChip } from "./RoleChip";

import awsmobile from "../aws-export";

const apiUrl = awsmobile.aws_backend_api_url

export const AdminList = (props) => {
  const { permissions } = usePermissions();

  const { data: admingroups } = useGetList("admingroups", {
    pagination: { page: 1, perPage: 60 },
    sort: { field: "createdAt", order: "DESC" },
  });

  // Filter group choices based on user's role
  const groupChoices = admingroups
    ? admingroups
        .filter((item) => {
          if (!permissions) return false;
          
          // SA sees all groups
          if (permissions.roleType === 'SA') return true;
          
          // SPA sees their SPA group and all TA groups
          if (permissions.roleType === 'SPA') {
            const userSPA = `SPA_${permissions.orgId}`;
            return item.group === userSPA || item.group.startsWith('TA_');
          }
          
          // TA only sees their own TA group(s)
          if (permissions.roleType === 'TA') {
            return permissions.roles.includes(item.group);
          }
          
          return false;
        })
        .map((item) => ({ id: item.id, name: item.group }))
    : [];
  const usersFilter = [
    <SelectInput
      label="Search Admin with Roles"
      source="groups"
      choices={groupChoices}
    />,
    <TextInput
      label="Search Users with email"
      source="email"
      alwaysOn
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton>
              <Search />
            </IconButton>
          </InputAdornment>
        ),
      }}
    />,
    <TextInput
      label="Search Users with last name"
      source="family_name"
      // alwaysOn
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton>
              <Search />
            </IconButton>
          </InputAdornment>
        ),
      }}
    />,
    <TextInput
      label="Search Users with first name"
      source="given_name"
      // alwaysOn
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton>
              <Search />
            </IconButton>
          </InputAdornment>
        ),
      }}
    />,
  ];

  const ListActions = () => {
    const redirect = useRedirect();
    const handleClick = () => {
      redirect("/importusers/create");
    };

    return (
      <TopToolbar>
        <FilterButton filters={usersFilter} disableSaveQuery />
        <CreateButton label="Invite Admin" />
      </TopToolbar>
    );
  };

  return (
    <div style={{ marginBottom: "5em" }}>
      <List
        {...props}
        filters={usersFilter}
        perPage={10}
        exporter={false}
        actions={<ListActions />}
      >
        <Datagrid
          rowClick={false}
          bulkActionButtons={false}
          optimized
        // key={configData}
        >
          <TextField
            source="email"
            sortable={false}
            sx={{ color: "#1A76D2" }}
          />
          <FunctionField
            label="Full Name"
            render={(record) =>
              `${record.given_name ? record.given_name : ""} ${record.family_name ? record.family_name : ""
              }`
            }
          />
          <TextField label="Location/Address" source="locale" sortable={false} />
          <ArrayField label="Admin Type" source="groups" sortable={false}>
            <SingleFieldList>
              <FunctionField
                render={(record) => <RoleChip role={record} />}
              />
            </SingleFieldList>
          </ArrayField>
          <FunctionField
            label="State"
            render={(record) =>
              `${record.enabled ? (record.status === 'EXTERNAL_PROVIDER' ? "Super Admin" : record.status) : "Disabled"}`
            }
          />
          <FunctionField
            label=""
            render={(record) => record.groups.includes("SA") ? "" : <UserListMenu record={record} />}
          />
        </Datagrid>
      </List>
      {/* {configData && (
        <Box display="flex" alignItems={"end"}>
          <Box>Total Users: </Box>
          <Box pl={2}> {configData?.totalUserNumber} </Box>
        </Box>
      )} */}
    </div>
  );
};
