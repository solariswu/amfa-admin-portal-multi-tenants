import { AccountCircle } from "@mui/icons-material";
import {
  Avatar,
  Container,
  Grid,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Typography,
  CircularProgress,
} from "@mui/material";

import * as React from "react";
import { useState, useEffect } from "react";
import {
  Edit,
  TextInput,
  AutocompleteArrayInput,
  FunctionField,
  Form,
  SaveButton,
  DeleteButton,
  TopToolbar,
  ListButton,
  TextField,
  DateInput,
  AutocompleteInput,
  usePermissions,
} from "react-admin";

import { isIDN, validatePhoneNumber } from "../utils/validation";
import awsmobile from "../aws-export";

const apiUrl = awsmobile.aws_backend_api_url;

export const AdminEdit = () => {
  const [groupChoices, setGroupChoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { permissions } = usePermissions();

  useEffect(() => {
    const fetchAvailableGroups = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('No authentication token found');
        }

        console.log('Fetching available groups from backend...');
        const response = await fetch(
          `${apiUrl}/admins?getAvailableGroups=true`,
          {
            headers: {
              'Authorization': token,
              'Content-Type': 'application/json',
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch groups: ${response.status}`);
        }

        const data = await response.json();
        console.log('Available groups response:', data);

        // Backend returns { data: { groups: [...] } }
        const groups = data.data?.groups || [];
        const choices = groups.map(g => ({ id: g, name: g }));
        
        console.log('Available group choices:', choices);
        setGroupChoices(choices);
      } catch (err) {
        console.error('Error fetching available groups:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAvailableGroups();
  }, []);

  const getHelpText = () => {
    if (!permissions) return 'Select user Role';
    
    switch (permissions.roleType) {
      case 'SA':
        return 'As Super Admin, you can assign any SPA or TA role';
      case 'SPA':
        return `As ${permissions.roles[0]}, you can assign your own SPA role or any TA role`;
      case 'TA':
        return `As Tenant Admin, you can only assign your own TA role(s)`;
      default:
        return 'Select user Role';
    }
  };

  const formValidation = (values) => {
    const errors = {};

    if (isIDN()(values["phone_number"])) {
      errors["phone_number"] = isIDN()(values["phone_number"]);
    }

    return errors;
  };

  const EditActions = () => (
    <TopToolbar>
      <DeleteButton
        confirmTitle="Are you sure you want to delete this user?"
        confirmContent=""
      />
      <ListButton />
    </TopToolbar>
  );

  return (
    <>
      <Edit
        mutationMode="pessimistic"
        redirect="show"
        actions={<EditActions />}
      >
        <Container style={{ padding: "15px" }}>
          <div
            style={{
              margin: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <FunctionField
              render={(record) => (
                <h1>{`Update ${
                  record.given_name
                    ? `- ${record.given_name.toUpperCase()}`
                    : "Profile"
                }`}</h1>
              )}
            />
            <FunctionField
              render={(record) => (
                record.license === false &&
                <h2><span style={{ color: "red" }}>User not licensed</span></h2>
              )}
            />
            <Form
              mode="onBlur"
              reValidateMode="onBlur"
              validate={formValidation}
            >
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={6} lg={5}>
                  <List>
                    <ListItem>
                      <ListItemAvatar>
                        <Avatar>
                          <AccountCircle />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary="EMAIL : "
                        secondary={
                          <>
                            <TextField
                              label={null}
                              onClick={() => {}}
                              source="email"
                              sx={{ color: "#1A76D2" }}
                            />
                          </>
                        }
                      />
                    </ListItem>
                  </List>
                </Grid>
                <Grid item xs={0} sm={6} md={6} lg={7} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    fullWidth
                    label="First Name"
                    source="given_name"
                    required
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    fullWidth
                    label="Last Name"
                    source="family_name"
                    required
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    label="SMS Phone Number"
                    fullWidth
                    source="phone_number"
                    validate={validatePhoneNumber}
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    fullWidth
                    label="Location/Address"
                    source="locale"
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <CircularProgress size={20} />
                      <Typography variant="body2">Loading available groups...</Typography>
                    </div>
                  ) : error ? (
                    <Typography color="error" variant="body2">
                      Error loading groups: {error}
                    </Typography>
                  ) : (
                    <AutocompleteArrayInput
                      label="User Role"
                      source="groups"
                      choices={groupChoices}
                      fullWidth
                      isRequired={true}
                      disabled={loading}
                      helperText={getHelpText()}
                    />
                  )}
                </Grid>
                <Grid item xs={12} sm={12} md={12} lg={12}>
                  <Typography color="text.secondary"> Extra Info</Typography>
                </Grid>
                <Grid item xs={3} sm={3} md={2} lg={1}>
                  <Typography>SUB:</Typography>
                </Grid>
                <Grid item xs={9} sm={9} md={10} lg={11}>
                  <TextField
                    label={null}
                    onClick={() => {}}
                    source="sub"
                    sx={{ color: "#1A76D2" }}
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput variant="outlined" fullWidth source="name" />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput
                    variant="outlined"
                    fullWidth
                    source="middle_name"
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput variant="outlined" fullWidth source="profile" />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <TextInput variant="outlined" fullWidth source="picture" />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <AutocompleteInput
                    source="gender"
                    choices={[
                      { id: "male", name: "male" },
                      { id: "female", name: "female" },
                      { id: "other", name: "other" },
                    ]}
                    fullWidth
                  />
                </Grid>
                <Grid item xs={12} sm={5} md={5} lg={5}>
                  <DateInput
                    label="Date of Birth"
                    fullWidth
                    source="birthdate"
                    allowempty="true"
                  />
                </Grid>
                <Grid item xs={0} sm={1} md={1} lg={1} />
              </Grid>
              <Grid container justify="flex-end">
                <Grid item xs={5} sm={5} md={5} lg={5}>
                  <SaveButton label="Update" />
                </Grid>
              </Grid>
            </Form>
          </div>
        </Container>
      </Edit>
    </>
  );
};
