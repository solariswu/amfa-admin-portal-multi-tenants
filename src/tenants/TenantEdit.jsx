import { useState, useEffect } from "react";
// import { useParams } from "react-router-dom";
import {
  Container,
  Divider,
  Grid,
  Box,
  Card,
  CardContent,
  Button,
  IconButton,
  FormControlLabel,
  Switch,
  Typography,
  CircularProgress,
} from "@mui/material";
import {
  Edit,
  TextField,
  FunctionField,
  UrlField,
  useNotify,
  Form,
  TextInput,
  TopToolbar,
  DeleteButton,
  SaveButton,
  ListButton,
  BooleanInput,
  NumberInput,
  PasswordInput,
  useRecordContext,
  FormDataConsumer,
} from "react-admin";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import awsmobile from "../aws-export";
import { canDeleteTenants } from "../utils/roleUtils";

const apiUrl = awsmobile.aws_backend_api_url;

export const TenantEdit = () => {
  const notify = useNotify();
  // const { id } = useParams();
  const [showSecret, setShowSecret] = useState(false);
  const [showTotpSecret, setShowTotpSecret] = useState(false);
  // const [showSMTPSecret, setShowSMTPSecret] = useState(false);
  const [inSending, setInSending] = useState(false);
  // const {record, save, isPending } = useEditController({ resource: 'tenants', id });

  // const [configData, setConfigData] = useState(null);

  // useEffect(() => {
  //   const fetchSmtp = async () => {
  //     let response = await fetch(`${apiUrl}/smtpconfig`, {
  //       headers: {
  //         Authorization: localStorage.getItem("token"),
  //         "Content-Type": "application/json",
  //         Accept: "application/json",
  //       },
  //     });
  //     let data = await response.json();
  //     console.log('smtpconfig data', data)
  //     setConfigData(data);
  //   };

  //   fetchSmtp();
  // }, []);

  const handleClick = (text) => {
    notify(`Copied to clipboard`, { type: "success" });
    navigator.clipboard.writeText(text);
  };

  const handleSMTPTest = async () => {
    let smtp = {};
    smtp.user = document.getElementById("user").value;
    smtp.pass = document.getElementById("pass").value;
    smtp.host = document.getElementById("host").value;
    smtp.secure = document.getElementById("secure").checked;
    smtp.port = document.getElementById("port").value;
    smtp.toUser = document.getElementById("toUser").value;

    setInSending(true);

    const res = await fetch(`${apiUrl}/smtpconfig`, {
      method: "POST",
      body: JSON.stringify({ data: smtp }),
      headers: {
        Authorization: localStorage.getItem("token"),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    setInSending(false);
    const json = await res.json();
    res.status !== 200 || json.type === "exception" || json.type === "Error"
      ? notify(`SMTP TEST email sent Error: ${json.data}`, { type: "error" })
      : notify(`SMTP Email sent successfully`, { type: "success" });
  };

  const TestSMTPButton = ({ formData }) =>
    inSending ? (
      <CircularProgress />
    ) : (
      <Button
        label="Test"
        onClick={handleSMTPTest}
        variant="contained"
        color="primary"
        startIcon={null}
        disabled={!formData || !formData.toUser || !formData.toUser.length}
      >
        Test SMTP
      </Button>
    );

  const DispCardItem = ({ title, source, showCopy }) => {
    const Content = ({ source }) => {
      switch (source) {
        case "clientSecret":
          return (
            <Box sx={{ paddingLeft: "10" }}>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showSecret}
                    onChange={(e) => setShowSecret(e.target.checked)}
                  />
                }
                label={<Typography fontSize={12}>show secret</Typography>}
              />
              <Box sx={{ display: "flex" }}>
                {showSecret ? (
                  <TextField
                    source={source}
                    color="text.secondary"
                    emptyText="---"
                    sx={{ paddingTop: "10px" }}
                  />
                ) : (
                  <Typography color="text.secondary">******</Typography>
                )}
                {showSecret && showCopy && (
                  <IconButton
                    onClick={() => handleClick(showCopy)}
                    size="small"
                  >
                    <ContentCopyIcon />
                  </IconButton>
                )}
              </Box>
            </Box>
          );
        case "Mobile_Token_Key":
          return (
            <Box sx={{ paddingLeft: "10" }}>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={showTotpSecret}
                    onChange={(e) => setShowTotpSecret(e.target.checked)}
                  />
                }
                label={<Typography fontSize={12}>show secret</Typography>}
              />
              <Box sx={{ display: "flex" }}>
                {showTotpSecret ? (
                  <TextField
                    source={source}
                    color="text.secondary"
                    emptyText="---"
                    sx={{ paddingTop: "10px" }}
                  />
                ) : (
                  <Typography color="text.secondary">******</Typography>
                )}
                {showTotpSecret && showCopy && (
                  <IconButton
                    onClick={() => handleClick(showCopy)}
                    size="small"
                  >
                    <ContentCopyIcon />
                  </IconButton>
                )}
              </Box>
            </Box>
          );
        case "endUserSpUrl":
          return (
            <Box sx={{ display: "flex" }}>
              <UrlField
                source={source}
                rel="noreferrer"
                target="_blank"
                emptyText=""
                sx={{ paddingTop: "10px" }}
              />
              {showCopy && (
                <IconButton onClick={() => handleClick(showCopy)} size="small">
                  <ContentCopyIcon />
                </IconButton>
              )}
            </Box>
          );
        case "samlIdPMetadataUrl":
          return (
            <Box sx={{ display: "flex" }}>
              <UrlField
                source={source}
                rel="noreferrer"
                target="_blank"
                emptyText=""
                sx={{ paddingTop: "10px" }}
              />
              {showCopy && (
                <IconButton onClick={() => handleClick(showCopy)} size="small">
                  <ContentCopyIcon />
                </IconButton>
              )}
            </Box>
          );
        default:
          return (
            <Box sx={{ display: "flex" }}>
              <TextField
                source={source}
                color="text.secondary"
                emptyText="---"
                sx={{ paddingTop: "10px" }}
              />
              {showCopy && (
                <IconButton onClick={() => handleClick(showCopy)} size="small">
                  <ContentCopyIcon />
                </IconButton>
              )}
            </Box>
          );
      }
    };

    return (
      <>
        <Box sx={{ paddingTop: "10px" }}>{title}</Box>
        <Content source={source} />
        <Divider />
      </>
    );
  };

  const EditActions = () => {
    const [showDelete, setShowDelete] = useState(false);

    useEffect(() => {
      const token = localStorage.getItem('token');
      setShowDelete(canDeleteTenants(token));
    }, []);

    return (
      <TopToolbar>
        {showDelete && (
          <DeleteButton
            confirmTitle="Delete this Tenant?"
            confirmContent="This will disable the tenant. Resources will be preserved."
            mutationMode="pessimistic"
          />
        )}
        <ListButton />
      </TopToolbar>
    );
  };

  const MobileTokenCard = () => (
    <Card sx={{ minWidth: "800px" }}>
      <Card>
        <CardContent>
          <Typography gutterBottom variant="h5" component="div">
            Mobile Token API Settings for aPersona ASM
          </Typography>
          <FunctionField
            render={(record) => {
              console.log('record', record)
              return <DispCardItem
                title={"Mobile Token Client Id"}
                source={"clientId"}
                showCopy={record.clientId}
              />
            }}
          />
          <Divider />
          <FunctionField
            render={(record) => (
              <DispCardItem
                title={"Mobile Token Client Secret"}
                source={"clientSecret"}
                showCopy={record.clientSecret}
              />
            )}
          />
          <Divider />
          <FunctionField
            render={(record) => (
              <DispCardItem
                title={"Mobile Token Auth Endpoint"}
                source={"domain"}
                showCopy={record.domain}
              />
            )}
          />
          <Divider />
          <FunctionField
            render={(record) => (
              <>
                <Box sx={{ paddingTop: "10px" }}>Mobile Token API endpoint</Box>
                <Box sx={{ display: "flex" }}>
                  <Typography variant="body" color="text.secondary">
                    {record.url.replace("https://", "https://api.") +
                      "/totptoken"}
                  </Typography>
                  <IconButton
                    onClick={() =>
                      handleClick(
                        record.url.replace("https://", "https://api.") +
                        "/totptoken",
                      )
                    }
                    size="small"
                  >
                    <ContentCopyIcon />
                  </IconButton>
                </Box>
              </>
            )}
          />
          <Divider />
        </CardContent>
      </Card>
    </Card>
  );

  const TenantInfoCard = () => (
    <Card>
      <CardContent>
        <FunctionField
          render={(record) => (
            <DispCardItem
              title={"Tenant ID"}
              source={"id"}
              showCopy={record.id}
            />
          )}
        />
        <Divider />
        <FunctionField
          render={(record) => (
            <DispCardItem
              title={"Tenant Name"}
              source={"name"}
              showCopy={decodeURIComponent(record.name)}
            />
          )}
        />
        <Divider />
      </CardContent>
    </Card>
  );

  const SPEndUserInfoCard = () => (
    <Card>
      <CardContent>
        <Typography gutterBottom variant="h5" component="div">
          SAML End User Service Portal Info
        </Typography>
        <FunctionField
          render={(record) => (
            <DispCardItem
              title={"End User Service Portal API URL"}
              source={"adminApiUrl"}
              showCopy={record.adminApiUrl}
            />
          )}
        />
        <FunctionField
          render={(record) => (
            <DispCardItem
              title={"End User Service Region"}
              source={"endUserSpRegion"}
              showCopy={record.endUserSpRegion}
            />
          )}
        />
        <Divider />
        <FunctionField
          render={(record) => (
            <DispCardItem
              title={"End User Service Userpools Web Client Id"}
              source={"endUserSpWebClientId"}
              showCopy={record.endUserSpWebClientId}
            />
          )}
        />
        <Divider />
        <FunctionField
          render={(record) => (
            <DispCardItem
              title={"End User Service Userpools Id"}
              source={"endUserSpUserpoolId"}
              showCopy={record.endUserSpUserpoolId}
            />
          )}
        />
        <Divider />
        <FunctionField
          render={(record) => (
            <DispCardItem
              title={"End User Service OAuth Domain"}
              source={"endUserSpOauthDomain"}
              showCopy={record.endUserSpOauthDomain}
            />
          )}
        />
        <Divider />
      </CardContent>
    </Card>
  );

  const MyForm = () => {
    const record = useRecordContext();

    if (!record || !record.clientId)
      return (
        <Container sx={{ padding: "15px" }}>
          <Box
            sx={{
              margin: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <CircularProgress
              sx={{ margin: "0 auto" }}
              size={36}
              thickness={2}
            />
          </Box>
        </Container>
      );

    return (
      <FormDataConsumer>
        {({ formData, ...rest }) => {
          return (
            <Container sx={{ padding: "15px" }}>
              <Box
                sx={{
                  margin: 8,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <FunctionField
                  render={(record) => (
                    <Typography variant="h4">
                      {decodeURIComponent(record.name)}
                    </Typography>
                  )}
                />
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={6} lg={5}>
                  <TenantInfoCard />
                  <Box sx={{ marginTop: "20px" }} />
                  <Card>
                    <CardContent>
                      <FunctionField
                        render={(record) => (
                          <DispCardItem
                            title={"End User Service Portal URL"}
                            source={"endUserSpUrl"}
                            showCopy={record.endUserSpUrl}
                          />
                        )}
                      />
                      <Divider />
                      {/* <Box sx={{ marginTop: "20px" }} />
                 <Card>
                  <CardContent>
                  <BooleanInput label="Enable SAML" source="samlproxy" /> */}
                      <FunctionField
                        render={(record) => (
                          <DispCardItem
                            title={"SAML IdP Metadata URL"}
                            source={"samlIdPMetadataUrl"}
                            showCopy={record.samlIdPMetadataUrl}
                          />
                        )}
                      />
                      <Divider />
                    </CardContent>
                  </Card>
                  <Box sx={{ marginTop: "20px" }} />
                  <SPEndUserInfoCard />
                </Grid>
                <Grid item xs={12} sm={6} md={6} lg={5}>
                  <Card sx={{ minWidth: "800px" }}>
                    <CardContent>
                      <Typography gutterBottom variant="h5" component="div">
                        SMTP server
                      </Typography>
                      <Grid container sx={{ marginTop: "20px" }}>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                          <TextInput source="host" id="host" />
                        </Grid>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                          <NumberInput source="port" id="port" />
                        </Grid>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                          <BooleanInput source="secure" id="secure" />
                        </Grid>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                          <TextInput source="user" id="user" />
                        </Grid>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                          <PasswordInput source="pass" id="pass" />
                        </Grid>
                      </Grid>
                      <Divider />
                      <Box sx={{ marginTop: "10px" }} />
                      <Grid container>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                          <TextInput
                            source="toUser"
                            type="email"
                            label="test email address"
                            id="toUser"
                            disabled={inSending}
                          />
                        </Grid>
                        <Grid item xs={12} sm={5} md={5} lg={4}>
                          <TestSMTPButton formData={formData} {...rest} />
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                  <Box sx={{ marginTop: "20px" }} />
                  <MobileTokenCard />
                  <Box sx={{ marginTop: "20px" }} />
                </Grid>
                <Grid container justify="flex-end">
                  <Grid item xs={9} sm={9} md={9} lg={9} />
                  <Grid item xs={2} sm={2} md={2} lg={2}>
                    <SaveButton label="Update" />
                  </Grid>
                </Grid>
              </Grid>
            </Container>
          );
        }}
      </FormDataConsumer>
    );
  };
  // if (isPending) return <CircularProgress sx={{ marginRight: 1 }} size={18} thickness={2} />

  return (
    <Edit
      mutationMode="pessimistic"
      redirect="list"
      actions={<EditActions />}
      emptyWhileLoading
    >
      <Form mode="onBlur" reValidateMode="onBlur">
        <MyForm />
      </Form>
    </Edit>
  );
};
