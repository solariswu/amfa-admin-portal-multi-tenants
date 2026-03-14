import {
  Toolbar,
  Button,
  List,
  Datagrid,
  TextField,
  useListContext,
  FunctionField,
} from "react-admin";
import { ChevronLeft, ChevronRight } from "@mui/icons-material";
import { Box, Chip } from "@mui/material";

const resource = "Branding";
const Pagination = () => {
  const { page, perPage, total, setPage } = useListContext();
  const nbPages = Math.ceil(total / perPage) || 1;
  const pages = Object.keys(
    localStorage.getItem(`${resource}tokenObj`)
      ? JSON.parse(localStorage.getItem(`${resource}tokenObj`))
      : [],
  );
  return (
    nbPages > 1 && (
      <Toolbar>
        {page > 1 && (
          <Button color="primary" key="prev" onClick={() => setPage(page - 1)}>
            <ChevronLeft />
            Prev
          </Button>
        )}
        {page &&
          pages.map((key, page) => {
            return (
              <Button
                color="primary"
                key={key}
                onClick={() => setPage(page + 1)}
              >
                {page + 1}
              </Button>
            );
          })}
        {page !== nbPages && (
          <Button color="primary" key="next" onClick={() => setPage(page + 1)}>
            Next
            <ChevronRight />
          </Button>
        )}
      </Toolbar>
    )
  );
};

export const BrandingList = (props) => {
  return (
    <Box sx={{ paddingTop: 5 }}>
      <List
        {...props}
        title={"Brandings"}
        perPage={10}
        pagination={<Pagination />}
        actions={<></>}
        exporter={false}
      >
        <Datagrid rowClick="show" bulkActionButtons={false} optimized>
          <FunctionField
            label="Portal Type"
            render={(record) => {
              if (record.portal_type === 'Login Service Portal') {
                return <Chip label="Login Service Portal" color="warning" size="small" />;
              }
              return (
                <Chip 
                  label="End User Portal"
                  color="info" 
                  size="small" 
                  variant="outlined"
                />
              );
            }}
            sortable={false}
          />
          <TextField label="Name" source="name" sortable={true} />
          <FunctionField
            label="Login Outter Color"
            render={(record) => (
              <Box
                sx={{
                  bgcolor: record.login_page_outter_color,
                  m: 1,
                  width: "1rem",
                  height: "1rem",
                  border: 1,
                }}
              />
            )}
          />
          <FunctionField
            label="Login Center Color"
            render={(record) => (
              <Box
                sx={{
                  bgcolor: record.login_page_center_color,
                  m: 1,
                  width: "1rem",
                  height: "1rem",
                  border: 1,
                }}
              />
            )}
          />
          <FunctionField
            label="App Bar Start Color"
            render={(record) => (
              <Box
                sx={{
                  bgcolor: record.app_bar_start_color,
                  m: 1,
                  width: "1rem",
                  height: "1rem",
                  border: 1,
                }}
              />
            )}
          />
          <FunctionField
            label="App Bar End Color"
            render={(record) => (
              <Box
                sx={{
                  bgcolor: record.app_bar_end_color,
                  m: 1,
                  width: "1rem",
                  height: "1rem",
                  border: 1,
                }}
              />
            )}
          />
          <FunctionField
            label="App Title Icon Color"
            render={(record) => (
              <Box
                sx={{
                  bgcolor: record.app_title_icon_color,
                  m: 1,
                  width: "1rem",
                  height: "1rem",
                  border: 1,
                }}
              />
            )}
          />
          <Button label="Edit" color="primary" icon="Edit" />
        </Datagrid>
      </List>
    </Box>
  );
};