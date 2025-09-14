import { useEffect, useState } from "react";

import {
  Button,
  List,
  Datagrid,
  ArrayField,
  SingleFieldList,
  FunctionField,
  TextField,
  ChipField,
  useRedirect,
  TextInput,
  CreateButton,
  TopToolbar,
  FilterButton,
  useGetList,
  SelectInput,
  WrapperField,
} from "react-admin";
import { InputAdornment, IconButton, Chip, Box } from "@mui/material";
import { Search } from "@mui/icons-material";
import PublishIcon from "@mui/icons-material/Publish";
import UserListMenu from "./AdminListMenu";

import awsmobile from "../aws-export";

const apiUrl = awsmobile.aws_backend_api_url;

export const AdminList = (props) => {
  const [configData, setConfigData] = useState(null);

  const { data: groups } = useGetList("groups", {
    pagination: { page: 1, perPage: 60 },
    sort: { field: "createdAt", order: "DESC" },
  });

  useEffect(() => {
    const fetchFeConfigs = async () => {
      let response = await fetch(`${apiUrl}/amfaconfig`, {
        headers: {
          Authorization: localStorage.getItem("token"),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      let data = await response.json();
      setConfigData(data);
    };

    fetchFeConfigs();
  }, []);

  const groupChoices = groups
    ? groups.map((item) => ({ id: item.id, name: item.group }))
    : [];
  const usersFilter = [
    <SelectInput
      label="Search Users with group"
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
        <CreateButton label="Invite User" />
        <Button onClick={handleClick} label="Import">
          <PublishIcon />
        </Button>
      </TopToolbar>
    );
  };

  const getUserGroup = (groups) => {
    let ug = "default";
    let ugRank = 10000;

    if (!groups?.length) {
      return ug;
    }

    for (let i = 0; i < groups.length; i++) {
      const groupName = groups[i].toLowerCase();
      if (
        configData?.amfaPolicies[groupName] &&
        configData?.amfaPolicies[groupName].rank < ugRank
      ) {
        ug = groupName;
        ugRank = configData?.amfaPolicies[groupName].rank;
      }
    }

    if (!configData?.amfaPolicies[ug]) {
      ug = "default";
    }

    return ug;
  };

  const intersectOtpPolicies = (
    usergroupPolicies,
    amfaConfigsMasterPolicies
  ) => {
    if (!amfaConfigsMasterPolicies) {
      return usergroupPolicies ? usergroupPolicies : [];
    }

    let intersection = usergroupPolicies.filter((policy) =>
      amfaConfigsMasterPolicies.includes(policy)
    );

    if (!intersection || !intersection.length) {
      intersection = ["e"];
    }

    if (!intersection.includes("e")) {
      intersection.push("e");
    }

    return intersection;
  };

  const MFAChannels = ({ record }) => {
    if (!configData?.amfaConfigs) {
      return null;
    }

    const masterMFAs = configData?.amfaConfigs?.master_additional_otp_methods;
    let ug = getUserGroup(record.groups);

    const availableMFAs = intersectOtpPolicies(
      configData?.amfaPolicies[ug]?.permissions,
      masterMFAs
    );

    if (!availableMFAs?.length) {
      return null;
    }

    let userMfaSetup = ["e"];
    availableMFAs.forEach((mfa) => {
      switch (mfa) {
        case "ae":
          if (record["alter-email"]) {
            userMfaSetup.push(mfa);
          }
          break;
        case "s":
          if (record.phone_number) {
            userMfaSetup.push(mfa);
          }
          break;
        case "v":
          if (record["voice-number"]) {
            userMfaSetup.push(mfa);
          }
          break;
        case "t":
          if (record.hasMobileToken) {
            userMfaSetup.push(mfa);
          }
          break;
        case "mp":
          if (record.hasPushNotification) {
            userMfaSetup.push(mfa);
          }
          break;
        default:
          break;
      }
    });

    return (
      <WrapperField label="MFA Channels">
        {availableMFAs.map((mfa) => (
          <Chip
            label={mfa.toUpperCase()}
            key={mfa}
            color={userMfaSetup.includes(mfa) ? "info" : "default"}
            size="small"
          />
        ))}
      </WrapperField>
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
          key={configData}
        >
          <TextField
            source="email"
            sortable={false}
            sx={{ color: "#1A76D2" }}
          />
          <FunctionField
            label="Full Name"
            render={(record) =>
              `${record.given_name ? record.given_name : ""} ${
                record.family_name ? record.family_name : ""
              }`
            }
          />
          <TextField label="Location/Address" source="locale" sortable={false} />
          <FunctionField
            label="MFA Channels"
            render={(record) => (
              <MFAChannels record={record} key={configData} />
            )}
          />
          <ArrayField label="User Group" source="groups" sortable={false}>
            <SingleFieldList>
              <FunctionField
                render={(record) => {
                  return (
                    <ChipField
                      record={{ name: record }}
                      source="name"
                      color={"warning"}
                      size="small"
                    />
                  );
                  // return <ChipField record={{ name: record }} source="name" color={record === ug ? 'warning': 'default'} />
                }}
              />
            </SingleFieldList>
          </ArrayField>
          <FunctionField
            label="State"
            render={(record) =>
              `${record.enabled ? record.status : "Disabled"}`
            }
          />
          <FunctionField
            label=""
            render={(record) => <UserListMenu record={record} />}
          />
        </Datagrid>
      </List>
      {configData && (
        <Box display="flex" alignItems={"end"}>
          <Box>Total Users: </Box>
          <Box pl={2}> {configData?.totalUserNumber} </Box>
        </Box>
      )}
    </div>
  );
};
